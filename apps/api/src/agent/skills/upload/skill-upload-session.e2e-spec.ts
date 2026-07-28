import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../../app.module'
import { PrismaService } from '../../../database/prisma.service'
import { InMemorySkillObjectStore } from '../storage/in-memory-skill-object-store'
import { SKILL_OBJECT_STORE_PORT } from '../storage/skill-object-store.port'
import { SkillUploadSessionService } from './skill-upload-session.service'

describe('SkillUploadSession PostgreSQL E2E', () => {
  let app: INestApplication
  let prisma: PrismaService
  let service: SkillUploadSessionService
  let objects: InMemorySkillObjectStore
  let userId: string

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    service = app.get(SkillUploadSessionService)
    objects = app.get(SKILL_OBJECT_STORE_PORT)
  })

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        authProvider: 'ANONYMOUS',
        providerUserId: `upload-e2e-${crypto.randomUUID().slice(0, 8)}`,
        userName: 'upload-e2e',
        lastLoginAt: new Date(),
      },
    })
    userId = user.id
  })

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  afterAll(async () => {
    await app.close()
  })

  it('persists idempotent finalize and abandoned cleanup states', async () => {
    const archive = Uint8Array.from([1, 2, 3, 4])
    const sha256 = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'
    const created = await service.create(userId, { sizeBytes: archive.byteLength, sha256 })
    objects.seedSkillPackage({
      objectKey: created.session.objectKey,
      archive,
      skillMarkdown: '# Upload',
      files: [],
    })

    await service.finalize(userId, created.session.id)
    await service.finalize(userId, created.session.id)
    await expect(
      prisma.skillUploadSession.findUniqueOrThrow({ where: { id: created.session.id } }),
    ).resolves.toMatchObject({
      status: 'FINALIZED',
      cleanupStatus: 'NONE',
      observedSizeBytes: 4n,
      observedSha256: sha256,
    })

    const expiredId = crypto.randomUUID()
    const expiredKey = `skill-staging/${userId}/${expiredId}/package.zip`
    await prisma.skillUploadSession.create({
      data: {
        id: expiredId,
        userId,
        objectKey: expiredKey,
        expectedContentType: 'application/zip',
        expectedSizeBytes: 1n,
        expectedSha256: 'a'.repeat(64),
        expiresAt: new Date(0),
      },
    })
    objects.seedSkillPackage({
      objectKey: expiredKey,
      archive: Uint8Array.of(1),
      skillMarkdown: '# Expired',
      files: [],
    })

    await expect(service.cleanupAbandoned()).resolves.toMatchObject({ cleaned: 1, pending: 0 })
    await expect(
      prisma.skillUploadSession.findUniqueOrThrow({ where: { id: expiredId } }),
    ).resolves.toMatchObject({
      status: 'ABANDONED',
      cleanupStatus: 'SUCCEEDED',
      cleanupAttempts: 1,
    })
    await expect(objects.statObject(expiredKey)).resolves.toBeNull()
  })
})
