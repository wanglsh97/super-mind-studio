import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../app.module'
import { PrismaService } from '../../database/prisma.service'
import { cleanupUserTestData } from '../../user-auth/user-auth.e2e-helpers'
import { ExecutableSkillRepository } from './executable-skill.repository'
import { MAX_ADDED_AGENT_SKILLS } from './executable-skill.service'

describe('Executable Skill added-state PostgreSQL E2E', () => {
  let app: INestApplication
  let prisma: PrismaService
  let repository: ExecutableSkillRepository

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    repository = app.get(ExecutableSkillRepository)
  })

  beforeEach(async () => {
    await cleanupUserTestData(prisma)
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('keeps concurrent add/remove idempotent and addCount isolated across users', async () => {
    const [owner, userA, userB] = await Promise.all([
      createUser(prisma, 'owner'),
      createUser(prisma, 'a'),
      createUser(prisma, 'b'),
    ])
    const skill = await createPublishedSkill(prisma, owner.id, 'shared')

    const results = await Promise.all(
      Array.from({ length: 5 }, () => repository.addForUser(userA.id, skill, 50)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    await expect(repository.addForUser(userB.id, skill, 50)).resolves.toBe(true)
    await expect(prisma.userAgentSkill.count({ where: { marketSkillId: skill.id } })).resolves.toBe(
      2,
    )
    await expect(
      prisma.skill.findUniqueOrThrow({ where: { id: skill.id } }),
    ).resolves.toMatchObject({ addCount: 2 })

    await Promise.all([
      repository.removeForUser(userA.id, skill.id),
      repository.removeForUser(userA.id, skill.id),
    ])
    await expect(
      prisma.userAgentSkill.count({ where: { userId: userB.id, marketSkillId: skill.id } }),
    ).resolves.toBe(1)
    await expect(
      prisma.skill.findUniqueOrThrow({ where: { id: skill.id } }),
    ).resolves.toMatchObject({ addCount: 1 })
  })

  it('rejects the 51st added Skill without changing its addCount', async () => {
    const [owner, user] = await Promise.all([
      createUser(prisma, 'limit-owner'),
      createUser(prisma, 'limit-user'),
    ])
    const skills = await Promise.all(
      Array.from({ length: MAX_ADDED_AGENT_SKILLS + 1 }, (_, index) =>
        createPublishedSkill(prisma, owner.id, `limit-${index}`),
      ),
    )
    await prisma.userAgentSkill.createMany({
      data: skills.slice(0, MAX_ADDED_AGENT_SKILLS).map((skill) => ({
        userId: user.id,
        skillId: skill.name,
        marketSkillId: skill.id,
      })),
    })
    await prisma.skill.updateMany({
      where: { id: { in: skills.slice(0, MAX_ADDED_AGENT_SKILLS).map((skill) => skill.id) } },
      data: { addCount: 1 },
    })

    const extra = skills.at(-1)!
    await expect(
      repository.addForUser(user.id, extra, MAX_ADDED_AGENT_SKILLS),
    ).rejects.toMatchObject({ limit: MAX_ADDED_AGENT_SKILLS })
    await expect(prisma.userAgentSkill.count({ where: { userId: user.id } })).resolves.toBe(
      MAX_ADDED_AGENT_SKILLS,
    )
    await expect(
      prisma.skill.findUniqueOrThrow({ where: { id: extra.id } }),
    ).resolves.toMatchObject({ addCount: 0 })
  })
})

async function createUser(prisma: PrismaService, suffix: string) {
  return prisma.user.create({
    data: {
      authProvider: 'ANONYMOUS',
      providerUserId: `added-${suffix}-${randomUUID().slice(0, 8)}`,
      userName: `added-${suffix}`,
      lastLoginAt: new Date(),
    },
  })
}

async function createPublishedSkill(prisma: PrismaService, ownerId: string, suffix: string) {
  const name = `added-${suffix}-${randomUUID().slice(0, 8)}`
  return prisma.skill.create({
    data: {
      name,
      ownerId,
      title: name,
      description: `${name} fixture`,
      category: 'development',
      status: 'PUBLISHED',
      packageObjectKey: `added/${name}/package.zip`,
      packageSha256: 'a'.repeat(64),
      packageSizeBytes: 10n,
      publishedAt: new Date(),
      packageUpdatedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      title: true,
      description: true,
      status: true,
      packageObjectKey: true,
      packageSha256: true,
    },
  })
}
