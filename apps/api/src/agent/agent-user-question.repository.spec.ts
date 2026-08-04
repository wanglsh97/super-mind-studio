import type { PrismaService } from '../database/prisma.service'
import { AgentUserQuestionRepository } from './agent-user-question.repository'

const createdAt = new Date('2026-08-04T08:00:00.000Z')

function pendingRow() {
  return {
    id: 'question-1',
    runId: 'run-1',
    toolCallId: 'tool-1',
    status: 'PENDING',
    questions: [
      {
        id: 'item-1',
        question: '几个人出行？',
        options: [{ id: 'option-1', label: '2 人' }],
        allowMultiple: false,
        allowOther: true,
      },
    ],
    createdAt,
    settledAt: null,
    run: {
      id: 'run-1',
      status: 'WAITING_FOR_USER',
      lastSequence: 8,
    },
  }
}

describe('AgentUserQuestionRepository', () => {
  it('scopes question lookup through the owning run', async () => {
    const findFirst = jest.fn().mockResolvedValue(null)
    const prisma = {
      agentUserQuestion: { findFirst },
    } as unknown as PrismaService
    const repository = new AgentUserQuestionRepository(prisma)

    await expect(repository.findForOwner('question-1', 'user-b')).resolves.toBeNull()
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'question-1', run: { userId: 'user-b' } },
    })
  })

  it('lets only the first settlement write answers, resume the run, and append an event', async () => {
    const row = pendingRow()
    const findFirst = jest.fn().mockResolvedValue(row)
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const answerCreateMany = jest.fn().mockResolvedValue({ count: 1 })
    const runUpdate = jest.fn().mockResolvedValue({})
    const eventCreate = jest.fn().mockResolvedValue({})
    const tx = {
      agentUserQuestion: { findFirst, updateMany, findUniqueOrThrow: jest.fn() },
      agentUserQuestionAnswer: { createMany: answerCreateMany },
      agentRun: { update: runUpdate },
      agentEvent: { create: eventCreate },
    }
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService
    const repository = new AgentUserQuestionRepository(prisma)
    const answers = [{ questionId: 'item-1', selectedOptionIds: ['option-1'] }]

    const result = await repository.answer('question-1', 'user-a', answers)

    expect(result).toMatchObject({
      settledNow: true,
      question: { id: 'question-1', status: 'answered' },
      event: { type: 'user-question-answered', sequence: 9, answers },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'question-1', status: 'PENDING' },
      data: { status: 'ANSWERED', settledAt: expect.any(Date) },
    })
    expect(answerCreateMany).toHaveBeenCalledTimes(1)
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'RUNNING', lastSequence: 9 },
    })
    expect(eventCreate).toHaveBeenCalledTimes(1)
  })

  it('returns the persisted winner when a concurrent settlement loses the atomic claim', async () => {
    const row = pendingRow()
    const winner = { ...row, status: 'SKIPPED', settledAt: createdAt }
    const findUniqueOrThrow = jest.fn().mockResolvedValue(winner)
    const tx = {
      agentUserQuestion: {
        findFirst: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow,
      },
      agentUserQuestionAnswer: { createMany: jest.fn() },
      agentRun: { update: jest.fn() },
      agentEvent: { create: jest.fn() },
    }
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService
    const repository = new AgentUserQuestionRepository(prisma)

    const result = await repository.answer('question-1', 'user-a', [
      { questionId: 'item-1', selectedOptionIds: ['option-1'] },
    ])

    expect(result).toMatchObject({
      settledNow: false,
      event: null,
      question: { status: 'skipped' },
    })
    expect(tx.agentUserQuestionAnswer.createMany).not.toHaveBeenCalled()
    expect(tx.agentRun.update).not.toHaveBeenCalled()
    expect(tx.agentEvent.create).not.toHaveBeenCalled()
  })

  it('cancels only still-pending questions for a run', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      agentUserQuestion: { updateMany },
    } as unknown as PrismaService
    const repository = new AgentUserQuestionRepository(prisma)

    await expect(repository.cancelPendingForRun('run-1')).resolves.toBe(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { runId: 'run-1', status: 'PENDING' },
      data: { status: 'CANCELLED', settledAt: expect.any(Date) },
    })
  })
})
