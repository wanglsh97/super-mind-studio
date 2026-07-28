import type { PrismaService } from '../../database/prisma.service'
import {
  AgentSkillAddLimitError,
  ExecutableSkillRepository,
  type ExecutableSkillRecord,
} from './executable-skill.repository'

const skill: ExecutableSkillRecord = {
  id: '00000000-0000-4000-8000-00000000a501',
  name: 'mock-data-cleaner',
  title: 'Mock 数据清洗',
  description: 'fixture',
  status: 'PUBLISHED',
  packageObjectKey: 'skills/mock-data-cleaner/package.zip',
  packageSha256: 'a'.repeat(64),
}

function setup() {
  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { upsert: jest.fn().mockResolvedValue({}) },
    skill: {
      upsert: jest.fn().mockResolvedValue(skill),
      update: jest.fn().mockResolvedValue({}),
    },
    userAgentSkill: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    skill: { findFirst: jest.fn() },
    userAgentSkill: { findFirst: jest.fn(), findMany: jest.fn() },
  } as unknown as PrismaService
  return { repository: new ExecutableSkillRepository(prisma), transaction, prisma }
}

describe('ExecutableSkillRepository', () => {
  it('seeds the deterministic owner and published Skill idempotently', async () => {
    const { repository, transaction } = setup()

    await expect(repository.ensureMockPublishedSkill()).resolves.toBe(skill)
    expect(transaction.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          authProvider_providerUserId: {
            authProvider: 'ANONYMOUS',
            providerUserId: 'system-skill-market',
          },
        },
        update: {},
      }),
    )
    expect(transaction.skill.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'mock-data-cleaner' },
        create: expect.objectContaining({ status: 'PUBLISHED' }),
        update: expect.objectContaining({
          packageObjectKey: 'skills/mock-data-cleaner/package.zip',
          packageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    )
  })

  it('serializes per-user adds and updates addCount only for a new row', async () => {
    const { repository, transaction, prisma } = setup()

    await expect(repository.addForUser('user-1', skill, 50)).resolves.toBe(true)
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1)
    expect(transaction.userAgentSkill.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        skillId: 'mock-data-cleaner',
        marketSkillId: skill.id,
      },
    })
    expect(transaction.skill.update).toHaveBeenCalledWith({
      where: { id: skill.id },
      data: { addCount: { increment: 1 } },
    })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })

    transaction.userAgentSkill.findUnique.mockResolvedValueOnce({ id: 'existing' })
    await expect(repository.addForUser('user-1', skill, 50)).resolves.toBe(false)
    expect(transaction.userAgentSkill.create).toHaveBeenCalledTimes(1)
  })

  it('rejects the 51st add and decrements count only when removal deletes a row', async () => {
    const { repository, transaction } = setup()
    transaction.userAgentSkill.count.mockResolvedValueOnce(50)

    await expect(repository.addForUser('user-1', skill, 50)).rejects.toBeInstanceOf(
      AgentSkillAddLimitError,
    )
    expect(transaction.userAgentSkill.create).not.toHaveBeenCalled()

    await repository.removeForUser('user-1', skill.id)
    expect(transaction.skill.update).toHaveBeenCalledWith({
      where: { id: skill.id },
      data: { addCount: { decrement: 1 } },
    })
    transaction.userAgentSkill.deleteMany.mockResolvedValueOnce({ count: 0 })
    await repository.removeForUser('user-1', skill.id)
    expect(transaction.skill.update).toHaveBeenCalledTimes(1)
  })
})
