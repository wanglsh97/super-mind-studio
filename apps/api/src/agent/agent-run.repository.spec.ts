import type { PrismaService } from '../database/prisma.service'
import { AgentRunRepository } from './agent-run.repository'

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
        where: { userId: 'user-a', status: { in: ['RUNNING', 'CANCELLING'] } },
      }),
    )
  })

  it('counts only active runs per user for the single-run constraint', async () => {
    const { count, repository } = setup()
    count.mockResolvedValue(1)

    await expect(repository.countActiveForUser('user-a')).resolves.toBe(1)
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'user-a', status: { in: ['RUNNING', 'CANCELLING'] } },
    })
  })

  it('interrupts abandoned runs with a terminal event and no provider replay', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'run-stale',
        lastSequence: 3,
      },
    ])
    const createMany = jest.fn().mockResolvedValue({ count: 1 })
    const updateMany = jest.fn()
    const update = jest.fn().mockResolvedValue({})
    const prisma = {
      agentRun: {
        findMany,
        update,
        updateMany,
        create: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      agentEvent: { createMany },
    } as unknown as PrismaService
    const repository = new AgentRunRepository(prisma)

    await expect(repository.interruptAbandonedRuns()).resolves.toEqual({
      count: 1,
      runIds: ['run-stale'],
    })
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            runId: 'run-stale',
            sequence: 4,
            type: 'run-terminal',
          }),
        ],
      }),
    )
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
