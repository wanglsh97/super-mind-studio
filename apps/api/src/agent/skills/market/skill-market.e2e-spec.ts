import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import type { AIGatewayClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../../app.module'
import { configureApplication } from '../../../configure-app'
import { PrismaService } from '../../../database/prisma.service'
import { RateLimitService } from '../../../rate-limit/rate-limit.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  FIXTURE_GITHUB_ID,
  provisionFixtureUserSession,
} from '../../../user-auth/user-auth.e2e-helpers'

describe('Public Skill market API E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let client: AIGatewayClient

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitService)
      .useValue({
        consumeChat: jest.fn().mockResolvedValue(undefined),
        consumeAdminLogin: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = module.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await cleanupUserTestData(prisma)
    client = createAuthenticatedClient(baseUrl, await provisionFixtureUserSession(app))
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('supports public pagination, search, category filters and stable sorting', async () => {
    const suffix = randomUUID().slice(0, 8)
    const owner = await prisma.user.create({
      data: {
        githubId: `market-${suffix}`,
        githubUsername: `author-${suffix}`,
        displayName: `Market Author ${suffix}`,
        lastLoginAt: new Date(),
      },
    })
    await Promise.all([
      createSkill(prisma, owner.id, {
        name: `market-fixture-alpha-${suffix}`,
        title: 'Alpha utility',
        category: 'data',
        addCount: 3,
        publishedAt: new Date('2026-07-20T00:00:00.000Z'),
      }),
      createSkill(prisma, owner.id, {
        name: `market-fixture-beta-${suffix}`,
        title: 'Beta utility',
        category: 'data',
        addCount: 9,
        publishedAt: new Date('2026-07-21T00:00:00.000Z'),
      }),
      createSkill(prisma, owner.id, {
        name: `market-fixture-content-${suffix}`,
        title: 'Content utility',
        category: 'content',
        addCount: 20,
        publishedAt: new Date('2026-07-22T00:00:00.000Z'),
      }),
      createSkill(prisma, owner.id, {
        name: `market-fixture-hidden-${suffix}`,
        title: 'Hidden utility',
        category: 'data',
        addCount: 99,
        publishedAt: new Date('2026-07-23T00:00:00.000Z'),
        status: 'DELISTED',
      }),
    ])

    const response = await fetch(
      `${baseUrl}/api/v1/skills?keyword=${suffix}&category=data&sort=popular&page=1&pageSize=1`,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      items: [
        {
          name: `market-fixture-beta-${suffix}`,
          publicationStatus: 'published',
          addState: 'not_added',
          addCount: 9,
          ownedByCurrentUser: false,
        },
      ],
    })

    const secondPage = await fetch(
      `${baseUrl}/api/v1/skills?keyword=author-${suffix}&category=data&sort=latest&page=2&pageSize=1`,
    )
    expect(secondPage.status).toBe(200)
    await expect(secondPage.json()).resolves.toMatchObject({
      total: 2,
      items: [{ name: `market-fixture-alpha-${suffix}` }],
    })
  })

  it('returns a safe detail projection and hides delisted Skills', async () => {
    const suffix = randomUUID().slice(0, 8)
    const owner = await prisma.user.create({
      data: {
        githubId: `market-detail-${suffix}`,
        githubUsername: `detail-author-${suffix}`,
        lastLoginAt: new Date(),
      },
    })
    const published = await createSkill(prisma, owner.id, {
      name: `market-detail-${suffix}`,
      title: 'Detail utility',
      category: 'development',
      addCount: 1,
      publishedAt: new Date(),
    })
    const hidden = await createSkill(prisma, owner.id, {
      name: `market-hidden-${suffix}`,
      title: 'Hidden detail',
      category: 'development',
      addCount: 0,
      publishedAt: new Date(),
      status: 'DELISTED',
    })

    const response = await fetch(`${baseUrl}/api/v1/skills/${published.name}`)
    expect(response.status).toBe(200)
    const detail = (await response.json()) as Record<string, unknown>
    expect(detail).toMatchObject({
      name: published.name,
      skillMarkdown: '# Safe Skill',
      files: [
        { path: 'SKILL.md', type: 'file', size: 12 },
        { path: 'scripts/run.sh', type: 'file', size: 42 },
      ],
    })
    expect(detail).not.toHaveProperty('packageObjectKey')
    expect(detail).not.toHaveProperty('packageSha256')
    expect(JSON.stringify(detail)).not.toContain('echo secret script body')

    const hiddenResponse = await fetch(`${baseUrl}/api/v1/skills/${hidden.name}`)
    expect(hiddenResponse.status).toBe(404)
    await expect(hiddenResponse.json()).resolves.toMatchObject({
      code: 'SKILL_NOT_FOUND',
      retryable: false,
    })
  })

  it('protects owner and add routes while the SDK adds, removes and lists owned Skills', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { githubId: FIXTURE_GITHUB_ID } })
    const skill = await createSkill(prisma, owner.id, {
      name: `market-owner-${randomUUID().slice(0, 8)}`,
      title: 'Owner utility',
      category: 'development',
      addCount: 0,
      publishedAt: new Date(),
    })

    const anonymous = await fetch(`${baseUrl}/api/v1/skills/owner`)
    expect(anonymous.status).toBe(401)
    await expect(client.skills.owner.list()).resolves.toEqual([
      expect.objectContaining({
        id: skill.id,
        name: skill.name,
        publicationStatus: 'published',
      }),
    ])

    await client.skills.add(skill.name)
    await client.skills.add(skill.name)
    await expect(
      prisma.userAgentSkill.count({ where: { userId: owner.id, marketSkillId: skill.id } }),
    ).resolves.toBe(1)
    await client.skills.remove(skill.name)
    await client.skills.remove(skill.name)
    await expect(
      prisma.userAgentSkill.count({ where: { userId: owner.id, marketSkillId: skill.id } }),
    ).resolves.toBe(0)
  })
})

function createSkill(
  prisma: PrismaService,
  ownerId: string,
  input: {
    name: string
    title: string
    category: string
    addCount: number
    publishedAt: Date
    status?: 'PUBLISHED' | 'DELISTED'
  },
) {
  return prisma.skill.create({
    data: {
      name: input.name,
      ownerId,
      title: input.title,
      description: `market fixture ${input.name}`,
      category: input.category,
      status: input.status ?? 'PUBLISHED',
      addCount: input.addCount,
      packageObjectKey: `skill-market/${input.name}/package.zip`,
      packageSha256: 'a'.repeat(64),
      packageSizeBytes: 10n,
      skillMarkdown: '# Safe Skill',
      fileTree: [
        { path: 'SKILL.md', type: 'file', size: 12 },
        { path: 'scripts/run.sh', type: 'file', size: 42 },
      ],
      publishedAt: input.publishedAt,
      packageUpdatedAt: input.publishedAt,
      ...(input.status === 'DELISTED' ? { delistedAt: new Date() } : {}),
    },
  })
}
