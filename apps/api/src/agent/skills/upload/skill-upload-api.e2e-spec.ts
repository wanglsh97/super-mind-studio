import type { AddressInfo } from 'node:net'

import { AIGatewayError, createAIGatewayClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ZipFile } from 'yazl'

import { AppModule } from '../../../app.module'
import { configureApplication } from '../../../configure-app'
import { PrismaService } from '../../../database/prisma.service'
import {
  cleanupUserTestData,
  createAuthenticatedFetch,
  provisionFixtureUserSession,
} from '../../../user-auth/user-auth.e2e-helpers'
import { InMemorySkillObjectStore } from '../storage/in-memory-skill-object-store'
import { SKILL_OBJECT_STORE_PORT } from '../storage/skill-object-store.port'

describe('Skill upload API and SDK E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let objects: InMemorySkillObjectStore

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
    objects = app.get<InMemorySkillObjectStore>(SKILL_OBJECT_STORE_PORT)
  })

  beforeEach(async () => {
    await cleanupUserTestData(prisma)
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('keeps package bytes on the direct OSS transport and finalizes metadata idempotently', async () => {
    const token = await provisionFixtureUserSession(app)
    const apiBodies: unknown[] = []
    const authenticatedFetch = createAuthenticatedFetch(token)
    const client = createAIGatewayClient({
      baseUrl,
      fetch: (input, init) => {
        apiBodies.push(init?.body)
        return authenticatedFetch(input, init)
      },
      skillUploadTransport: async (request) => {
        const objectKey = decodeURIComponent(new URL(request.url).pathname.slice(1))
        const archive = new Uint8Array(await request.body.arrayBuffer())
        objects.seedSkillPackage({
          objectKey,
          archive,
          skillMarkdown: '# Upload fixture',
          files: [{ path: 'SKILL.md', type: 'file', size: archive.byteLength }],
        })
        request.onProgress?.(archive.byteLength, archive.byteLength)
      },
    })
    const archive = new Blob([await zipSkillPackage()], { type: 'application/zip' })

    const finalized = await client.agent.skills.uploadPackage(archive, { retryDelayMs: 0 })

    expect(finalized).toMatchObject({
      status: 'finalized',
      sizeBytes: archive.size,
    })
    expect(apiBodies).toHaveLength(2)
    expect(apiBodies.every((body) => typeof body === 'string' || body === undefined)).toBe(true)
    expect(apiBodies.some((body) => body === archive)).toBe(false)
    await expect(
      prisma.skillUploadSession.findUniqueOrThrow({ where: { id: finalized.sessionId } }),
    ).resolves.toMatchObject({
      status: 'FINALIZED',
      expectedSizeBytes: BigInt(archive.size),
      observedSizeBytes: BigInt(archive.size),
      observedSha256: finalized.sha256,
    })

    await expect(
      client.agent.skills.uploadPackage(new Blob([], { type: 'application/zip' })),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('requires an authenticated user before issuing an OSS upload credential', async () => {
    const response = await fetch(`${baseUrl}/api/v1/agent/skills/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sizeBytes: 1, sha256: 'a'.repeat(64) }),
    })
    expect(response.status).toBe(401)
  })

  it('returns the stable upload error when finalized OSS metadata does not match', async () => {
    const token = await provisionFixtureUserSession(app)
    const client = createAIGatewayClient({
      baseUrl,
      fetch: createAuthenticatedFetch(token),
      skillUploadTransport: async (request) => {
        const objectKey = decodeURIComponent(new URL(request.url).pathname.slice(1))
        objects.seedSkillPackage({
          objectKey,
          archive: new TextEncoder().encode('mismatcH'),
          skillMarkdown: '# mismatch',
          files: [{ path: 'SKILL.md', type: 'file', size: 8 }],
        })
      },
    })

    await expect(
      client.agent.skills.uploadPackage(new Blob(['expected']), { retryDelayMs: 0 }),
    ).rejects.toMatchObject({
      code: 'UPLOAD_OBJECT_MISMATCH',
      status: 400,
      retryable: false,
    } satisfies Partial<AIGatewayError>)
  })
})

async function zipSkillPackage(): Promise<Uint8Array> {
  const archive = new ZipFile()
  archive.addBuffer(Buffer.from('# Upload fixture'), 'SKILL.md')
  archive.addBuffer(Buffer.from('console.log("ok")'), 'scripts/run.mjs')
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
