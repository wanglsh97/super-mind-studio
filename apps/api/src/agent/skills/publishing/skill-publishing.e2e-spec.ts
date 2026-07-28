import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../../app.module'
import { PrismaService } from '../../../database/prisma.service'
import { cleanupUserTestData } from '../../../user-auth/user-auth.e2e-helpers'
import { ExecutableSkillService } from '../executable-skill.service'
import { SkillPublishingService } from './skill-publishing.service'

describe('Skill publishing claim PostgreSQL E2E', () => {
  let app: INestApplication
  let prisma: PrismaService
  let service: SkillPublishingService
  let executableSkills: ExecutableSkillService

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    service = app.get(SkillPublishingService)
    executableSkills = app.get(ExecutableSkillService)
  })

  beforeEach(async () => {
    await cleanupUserTestData(prisma)
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('allows exactly one concurrent global-name claimant and binds ownership', async () => {
    const [userA, userB] = await Promise.all([createUser(prisma, 'a'), createUser(prisma, 'b')])
    const [uploadA, uploadB] = await Promise.all([
      createFinalizedUpload(prisma, userA.id, 'a'),
      createFinalizedUpload(prisma, userB.id, 'b'),
    ])
    const submit = (userId: string, uploadSessionId: string) =>
      service.claim(userId, {
        uploadSessionId,
        name: 'global-cleaner',
        title: 'Global Cleaner',
        description: 'Cleans deterministic fixtures.',
        category: 'data',
      })

    const results = await Promise.allSettled([
      submit(userA.id, uploadA.id),
      submit(userB.id, uploadB.id),
    ])

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof submit>>> =>
        result.status === 'fulfilled',
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ code: 'SKILL_NAME_TAKEN' })
    await expect(prisma.skill.count({ where: { name: 'global-cleaner' } })).resolves.toBe(1)
    await expect(
      service.requireOwner(fulfilled[0]!.value.ownerId, 'global-cleaner'),
    ).resolves.toMatchObject({
      id: fulfilled[0]!.value.id,
    })
    const losingUserId = fulfilled[0]!.value.ownerId === userA.id ? userB.id : userA.id
    await expect(service.requireOwner(losingUserId, 'global-cleaner')).rejects.toMatchObject({
      code: 'SKILL_NOT_OWNER',
    })
  })

  it('consumes one finalized upload once and enforces the database category constraint', async () => {
    const user = await createUser(prisma, 'single')
    const upload = await createFinalizedUpload(prisma, user.id, 'single')
    await service.claim(user.id, {
      uploadSessionId: upload.id,
      name: 'first-name',
      title: 'First',
      description: 'First claim.',
      category: 'development',
    })
    await expect(
      service.claim(user.id, {
        uploadSessionId: upload.id,
        name: 'second-name',
        title: 'Second',
        description: 'Second claim.',
        category: 'development',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_UPLOAD_NOT_FINALIZED' })
    await expect(
      prisma.skill.create({
        data: {
          name: 'invalid-category',
          ownerId: user.id,
          title: 'Invalid',
          description: 'Invalid category.',
          category: 'custom',
        },
      }),
    ).rejects.toThrow()
  })

  it('overwrites the published object metadata in place without a revision or another review', async () => {
    const user = await createUser(prisma, 'overwrite')
    const firstUpload = await createFinalizedUpload(prisma, user.id, 'first')
    const claimed = await service.claim(user.id, {
      uploadSessionId: firstUpload.id,
      name: 'overwrite-skill',
      title: 'Before',
      description: 'Before overwrite.',
      category: 'development',
    })
    const publishedAt = new Date('2026-07-23T15:00:00.000Z')
    await prisma.skill.update({
      where: { id: claimed.id },
      data: { status: 'PUBLISHED', publishedAt },
    })
    await prisma.skillReview.create({
      data: {
        skillId: claimed.id,
        reviewer: 'root',
        decision: 'APPROVED',
        packageSha256: firstUpload.observedSha256!,
      },
    })

    const replacement = await createFinalizedUpload(prisma, user.id, 'replacement', {
      skillId: claimed.id,
      objectKey: claimed.packageObjectKey!,
      sha256: 'b'.repeat(64),
      sizeBytes: 20n,
    })
    await expect(
      service.updatePublished(user.id, claimed.name, {
        uploadSessionId: replacement.id,
        title: 'After',
        description: 'After overwrite.',
        category: 'productivity',
      }),
    ).resolves.toMatchObject({
      id: claimed.id,
      status: 'PUBLISHED',
      packageObjectKey: claimed.packageObjectKey,
      packageSha256: 'b'.repeat(64),
      packageSizeBytes: 20n,
    })

    await expect(prisma.skill.count({ where: { name: claimed.name } })).resolves.toBe(1)
    await expect(prisma.skillReview.count({ where: { skillId: claimed.id } })).resolves.toBe(1)
    await expect(
      prisma.skill.findUniqueOrThrow({ where: { id: claimed.id } }),
    ).resolves.toMatchObject({
      status: 'PUBLISHED',
      publishedAt,
      title: 'After',
      description: 'After overwrite.',
      category: 'productivity',
      packageObjectKey: claimed.packageObjectKey,
      packageSha256: 'b'.repeat(64),
      packageSizeBytes: 20n,
    })
  })

  it('keeps existing adds after owner delisting while hiding and rejecting new activation', async () => {
    const owner = await createUser(prisma, 'delist-owner')
    const user = await createUser(prisma, 'delist-user')
    const upload = await createFinalizedUpload(prisma, owner.id, 'delist')
    const skill = await service.claim(owner.id, {
      uploadSessionId: upload.id,
      name: 'owner-delist-skill',
      title: 'Owner delist',
      description: 'Owner delist behavior.',
      category: 'development',
    })
    await prisma.skill.update({
      where: { id: skill.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
    await executableSkills.add(user.id, skill.name)

    await expect(service.delistOwned(owner.id, skill.name)).resolves.toMatchObject({
      status: 'DELISTED',
    })
    await expect(executableSkills.listCandidates(user.id)).resolves.toEqual([])
    await expect(executableSkills.prepareActivation(user.id, [skill.name])).rejects.toMatchObject({
      code: 'SKILL_NOT_ADDED',
    })
    await expect(
      prisma.skill.count({ where: { name: skill.name, status: 'PUBLISHED' } }),
    ).resolves.toBe(0)
    await expect(
      prisma.userAgentSkill.count({ where: { userId: user.id, marketSkillId: skill.id } }),
    ).resolves.toBe(1)
    await expect(
      prisma.skill.findUniqueOrThrow({ where: { id: skill.id } }),
    ).resolves.toMatchObject({
      status: 'DELISTED',
      addCount: 1,
    })

    await executableSkills.remove(user.id, skill.name)
    await expect(
      prisma.userAgentSkill.count({ where: { userId: user.id, marketSkillId: skill.id } }),
    ).resolves.toBe(0)
    await expect(
      prisma.skill.findUniqueOrThrow({ where: { id: skill.id } }),
    ).resolves.toMatchObject({
      addCount: 0,
    })
  })
})

async function createUser(prisma: PrismaService, suffix: string) {
  return prisma.user.create({
    data: {
      authProvider: 'ANONYMOUS',
      providerUserId: `claim-${suffix}-${randomUUID().slice(0, 8)}`,
      userName: `claim-${suffix}`,
      lastLoginAt: new Date(),
    },
  })
}

async function createFinalizedUpload(
  prisma: PrismaService,
  userId: string,
  suffix: string,
  options: {
    skillId?: string
    objectKey?: string
    sha256?: string
    sizeBytes?: bigint
  } = {},
) {
  const id = randomUUID()
  const sha256 = options.sha256 ?? 'a'.repeat(64)
  const sizeBytes = options.sizeBytes ?? 10n
  return prisma.skillUploadSession.create({
    data: {
      id,
      userId,
      ...(options.skillId === undefined ? {} : { skillId: options.skillId }),
      objectKey: options.objectKey ?? `skill-staging/${userId}/${id}/package-${suffix}.zip`,
      status: 'FINALIZED',
      expectedContentType: 'application/zip',
      expectedSizeBytes: sizeBytes,
      expectedSha256: sha256,
      observedSizeBytes: sizeBytes,
      observedSha256: sha256,
      expiresAt: new Date(Date.now() + 300_000),
      finalizedAt: new Date(),
    },
  })
}
