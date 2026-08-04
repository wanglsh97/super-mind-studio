import type { PrismaService } from '../database/prisma.service'
import {
  AgentRunRepository,
  AgentThreadActiveRunError,
  AgentUserConcurrencyLimitError,
} from './agent-run.repository'

function setup() {
  const create = jest.fn()
  const findFirst = jest.fn()
  const count = jest.fn()
  const update = jest.fn()
  const prisma = {
    agentRun: { create, findFirst, count, update },
  } as unknown as PrismaService
  return { create, findFirst, count, update, repository: new AgentRunRepository(prisma) }
}

describe('AgentRunRepository', () => {
  it('scopes run lookups by owner userId', async () => {
    const { findFirst, repository } = setup()
    findFirst.mockResolvedValue(null)

    await expect(repository.findForOwner('run-of-a', 'user-b')).resolves.toBeNull()
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'run-of-a', userId: 'user-b' } })
  })

  it('finds the active run for a user across all their threads', async () => {
    const { findFirst, repository } = setup()
    findFirst.mockResolvedValue({ id: 'run-1' })

    await repository.findActiveForUser('user-a')

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          status: { in: ['RUNNING', 'CANCELLING', 'WAITING_FOR_USER'] },
        },
      }),
    )
  })

  it('lists every active run for a user across different Threads', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'run-b' }, { id: 'run-a' }])
    const prisma = {
      agentRun: { findMany },
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await expect(repository.listActiveForUser('user-a')).resolves.toHaveLength(2)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        status: { in: ['RUNNING', 'CANCELLING', 'WAITING_FOR_USER'] },
      },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('counts only active runs per user for the single-run constraint', async () => {
    const { count, repository } = setup()
    count.mockResolvedValue(1)

    await expect(repository.countActiveForUser('user-a')).resolves.toBe(1)
    expect(count).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        status: { in: ['RUNNING', 'CANCELLING', 'WAITING_FOR_USER'] },
      },
    })
  })

  it('atomically admits a second run for the user in a different Thread', async () => {
    const run = { id: 'run-b', threadId: 'thread-b', userId: 'user-a' }
    const executeRaw = jest.fn().mockResolvedValue(1)
    const runFindFirst = jest.fn().mockResolvedValue(null)
    const runCount = jest.fn().mockResolvedValue(1)
    const runCreate = jest.fn().mockResolvedValue(run)
    const messageFindFirst = jest.fn().mockResolvedValue({ sequence: 4 })
    const messageCreate = jest.fn().mockResolvedValue({})
    const threadUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const tx = {
      $executeRaw: executeRaw,
      agentRun: { findFirst: runFindFirst, count: runCount, create: runCreate },
      agentMessage: { findFirst: messageFindFirst, create: messageCreate },
      agentThread: { updateMany: threadUpdateMany },
    }
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await expect(
      repository.admit({
        threadId: 'thread-b',
        userId: 'user-a',
        input: 'parallel task',
        maxConcurrentRuns: 2,
        derivedTitle: 'parallel task',
      }),
    ).resolves.toBe(run)
    expect(runCount).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        status: { in: ['RUNNING', 'CANCELLING', 'WAITING_FOR_USER'] },
      },
    })
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ threadId: 'thread-b', runId: 'run-b', sequence: 5 }),
      }),
    )
  })

  it('rejects atomic admission when the target Thread already has an active run', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      agentRun: {
        findFirst: jest.fn().mockResolvedValue({ id: 'run-existing' }),
        count: jest.fn(),
      },
    }
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await expect(
      repository.admit({
        threadId: 'thread-a',
        userId: 'user-a',
        input: 'duplicate',
        maxConcurrentRuns: 2,
      }),
    ).rejects.toMatchObject<Partial<AgentThreadActiveRunError>>({
      activeRunId: 'run-existing',
    })
    expect(tx.agentRun.count).not.toHaveBeenCalled()
  })

  it('rejects atomic admission when the user concurrency limit is reached', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      agentRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn(),
      },
    }
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await expect(
      repository.admit({
        threadId: 'thread-c',
        userId: 'user-a',
        input: 'over limit',
        maxConcurrentRuns: 2,
      }),
    ).rejects.toMatchObject<Partial<AgentUserConcurrencyLimitError>>({ limit: 2 })
    expect(tx.agentRun.create).not.toHaveBeenCalled()
  })

  it('interrupts abandoned runs with a terminal event and no provider replay', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'run-stale',
        lastSequence: 3,
      },
    ])
    const create = jest.fn().mockResolvedValue({})
    const questionUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const update = jest.fn().mockResolvedValue({})
    const tx = {
      agentRun: { findMany, update },
      agentEvent: { create },
      agentUserQuestion: { updateMany: questionUpdateMany },
    }
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await expect(repository.interruptAbandonedRuns()).resolves.toEqual({
      count: 1,
      runIds: ['run-stale'],
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run-stale',
          sequence: 4,
          type: 'run-terminal',
        }),
      }),
    )
    expect(questionUpdateMany).toHaveBeenCalledWith({
      where: { runId: 'run-stale', status: 'PENDING' },
      data: { status: 'INTERRUPTED', settledAt: expect.any(Date) },
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-stale' },
        data: expect.objectContaining({
          status: 'INTERRUPTED',
          errorCode: 'AGENT_INTERRUPTED',
        }),
      }),
    )
  })

  it('persists normalized tool error fields alongside the bounded audit', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'record-1' })
    const updateMany = jest.fn()
    const prisma = {
      agentToolCall: { upsert },
      userFile: { updateMany },
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await repository.saveToolCalls('run-1', [
      {
        toolCallId: 'call-1',
        toolName: 'write_file',
        args: { path: '/workspace/output/logo.svg', content: '[omitted 6 bytes]' },
        status: 'failed',
        summary: 'Run Sandbox 尚未创建',
        audit: { code: 'SANDBOX_UNAVAILABLE' },
        isError: true,
      },
    ])

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          errorCode: 'SANDBOX_UNAVAILABLE',
          errorMessage: 'Run Sandbox 尚未创建',
        }),
        update: expect.objectContaining({
          errorCode: 'SANDBOX_UNAVAILABLE',
          errorMessage: 'Run Sandbox 尚未创建',
        }),
      }),
    )
    expect(updateMany).not.toHaveBeenCalled()
  })
})
