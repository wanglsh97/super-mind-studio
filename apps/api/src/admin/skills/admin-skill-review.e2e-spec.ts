import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../app.module'
import { configureApplication } from '../../configure-app'
import { PrismaService } from '../../database/prisma.service'
import { RateLimitService } from '../../rate-limit/rate-limit.service'
import { cleanupUserTestData } from '../../user-auth/user-auth.e2e-helpers'

describe('Admin Skill review API E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService

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
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await prisma.adminAuditLog.deleteMany()
    await cleanupUserTestData(prisma)
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.adminAuditLog.deleteMany()
      await cleanupUserTestData(prisma)
    }
    if (app) await app.close()
  })

  it('protects review APIs and transitions pending Skills once with rejection reasons', async () => {
    const owner = await prisma.user.create({
      data: {
        authProvider: 'ANONYMOUS',
        providerUserId: `review-${randomUUID().slice(0, 8)}`,
        userName: 'review-owner',
        lastLoginAt: new Date(),
      },
    })
    const [approveSkill, rejectSkill] = await Promise.all([
      createPendingSkill(prisma, owner.id, 'approve-me'),
      createPendingSkill(prisma, owner.id, 'reject-me'),
    ])

    const anonymous = await fetch(`${baseUrl}/api/v1/admin/skills/reviews`)
    expect(anonymous.status).toBe(401)
    const cookie = await login(baseUrl)

    const pending = await fetch(`${baseUrl}/api/v1/admin/skills/reviews`, {
      headers: { cookie },
    })
    expect(pending.status).toBe(200)
    await expect(pending.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: approveSkill.id, status: 'PENDING_REVIEW' }),
        expect.objectContaining({ id: rejectSkill.id, status: 'PENDING_REVIEW' }),
      ]),
    )

    const approved = await fetch(`${baseUrl}/api/v1/admin/skills/${approveSkill.id}/approve`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(approved.status).toBe(201)
    await expect(approved.json()).resolves.toMatchObject({ status: 'PUBLISHED' })

    const rejected = await fetch(`${baseUrl}/api/v1/admin/skills/${rejectSkill.id}/reject`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '  缺少可复现的使用说明  ' }),
    })
    expect(rejected.status).toBe(201)
    await expect(rejected.json()).resolves.toMatchObject({ status: 'REJECTED' })

    const repeated = await fetch(`${baseUrl}/api/v1/admin/skills/${approveSkill.id}/approve`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(repeated.status).toBe(409)
    await expect(repeated.json()).resolves.toMatchObject({
      code: 'SKILL_REVIEW_INVALID_TRANSITION',
      retryable: false,
    })

    const delisted = await fetch(`${baseUrl}/api/v1/admin/skills/${approveSkill.id}/delist`, {
      method: 'POST',
      headers: { cookie },
    })
    expect(delisted.status).toBe(201)
    await expect(delisted.json()).resolves.toMatchObject({ status: 'DELISTED' })

    await expect(prisma.skillReview.findMany({ orderBy: { createdAt: 'asc' } })).resolves.toEqual([
      expect.objectContaining({
        skillId: approveSkill.id,
        reviewer: 'root',
        decision: 'APPROVED',
        reason: null,
      }),
      expect.objectContaining({
        skillId: rejectSkill.id,
        reviewer: 'root',
        decision: 'REJECTED',
        reason: '缺少可复现的使用说明',
      }),
    ])

    await expect(
      prisma.adminAuditLog.findMany({
        where: { targetTable: 'Skill' },
        orderBy: { createdAt: 'asc' },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: 'root',
          action: 'UPDATE',
          targetId: approveSkill.id,
          beforeData: expect.objectContaining({ status: 'PENDING_REVIEW' }),
          afterData: expect.objectContaining({
            status: 'PUBLISHED',
            reviewOperation: 'approve',
          }),
        }),
        expect.objectContaining({
          actor: 'root',
          action: 'UPDATE',
          targetId: rejectSkill.id,
          beforeData: expect.objectContaining({ status: 'PENDING_REVIEW' }),
          afterData: expect.objectContaining({
            status: 'REJECTED',
            reviewOperation: 'reject',
          }),
        }),
        expect.objectContaining({
          actor: 'root',
          action: 'UPDATE',
          targetId: approveSkill.id,
          beforeData: expect.objectContaining({ status: 'PUBLISHED' }),
          afterData: expect.objectContaining({
            status: 'DELISTED',
            reviewOperation: 'delist',
          }),
        }),
      ]),
    )
  })

  it('rolls back the Skill transition and review when audit persistence fails', async () => {
    const owner = await prisma.user.create({
      data: {
        authProvider: 'ANONYMOUS',
        providerUserId: `review-rollback-${randomUUID().slice(0, 8)}`,
        userName: 'review-rollback-owner',
        lastLoginAt: new Date(),
      },
    })
    const skill = await createPendingSkill(prisma, owner.id, 'rollback-me')
    const cookie = await login(baseUrl)

    await installAuditFailureTrigger(prisma)
    try {
      const response = await fetch(`${baseUrl}/api/v1/admin/skills/${skill.id}/approve`, {
        method: 'POST',
        headers: { cookie },
      })
      expect(response.status).toBe(500)

      await expect(
        prisma.skill.findUniqueOrThrow({ where: { id: skill.id } }),
      ).resolves.toMatchObject({
        status: 'PENDING_REVIEW',
        publishedAt: null,
      })
      await expect(prisma.skillReview.count({ where: { skillId: skill.id } })).resolves.toBe(0)
      await expect(
        prisma.adminAuditLog.count({
          where: { targetTable: 'Skill', targetId: skill.id },
        }),
      ).resolves.toBe(0)
    } finally {
      await removeAuditFailureTrigger(prisma)
    }
  })
})

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: '123456' }),
  })
  expect(response.status).toBe(201)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('admin login did not set a cookie')
  return cookie
}

function createPendingSkill(prisma: PrismaService, ownerId: string, name: string) {
  return prisma.skill.create({
    data: {
      name,
      ownerId,
      title: name,
      description: `${name} description`,
      category: 'development',
      status: 'PENDING_REVIEW',
      packageObjectKey: `skill-staging/${ownerId}/${name}/package.zip`,
      packageSha256: 'a'.repeat(64),
      packageSizeBytes: 10n,
      packageUpdatedAt: new Date(),
    },
  })
}

async function installAuditFailureTrigger(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_skill_audit_test()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."targetTable" = 'Skill' THEN
        RAISE EXCEPTION 'intentional skill audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_skill_audit_test_trigger
    BEFORE INSERT ON "AdminAuditLog"
    FOR EACH ROW EXECUTE FUNCTION fail_skill_audit_test()
  `)
}

async function removeAuditFailureTrigger(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS fail_skill_audit_test_trigger ON "AdminAuditLog"
  `)
  await prisma.$executeRawUnsafe(`
    DROP FUNCTION IF EXISTS fail_skill_audit_test()
  `)
}
