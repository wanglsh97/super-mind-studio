import type {
  AgentStreamEvent,
  AgentUserQuestion,
  AgentUserQuestionAnswerItem,
} from '@supermind/sdk'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service'
import { Prisma } from '../generated/prisma/client'

export interface CreatePendingQuestionInput {
  id: string
  runId: string
  userId: string
  toolCallId: string
  questions: AgentUserQuestion['questions']
}

export interface QuestionWriteResult {
  question: AgentUserQuestion
  event: AgentStreamEvent | null
  settledNow: boolean
}

export class AgentUserQuestionAlreadyPendingError extends Error {
  constructor() {
    super('Agent run already has a pending question batch')
    this.name = 'AgentUserQuestionAlreadyPendingError'
  }
}

@Injectable()
export class AgentUserQuestionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createPending(
    input: CreatePendingQuestionInput,
  ): Promise<{ question: AgentUserQuestion; event: AgentStreamEvent }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const run = await tx.agentRun.findFirst({
          where: { id: input.runId, userId: input.userId, status: 'RUNNING' },
        })
        if (!run) throw new Error('Agent run is not available for a question')

        const createdAt = new Date()
        await tx.agentUserQuestion.create({
          data: {
            id: input.id,
            runId: input.runId,
            toolCallId: input.toolCallId,
            questions: input.questions as unknown as Prisma.InputJsonValue,
            createdAt,
          },
        })
        const sequence = run.lastSequence + 1
        await tx.agentRun.update({
          where: { id: input.runId },
          data: { status: 'WAITING_FOR_USER', lastSequence: sequence },
        })
        const question: AgentUserQuestion = {
          id: input.id,
          runId: input.runId,
          status: 'pending',
          questions: input.questions,
          createdAt: createdAt.toISOString(),
          settledAt: null,
        }
        const event: AgentStreamEvent = {
          type: 'user-question-asked',
          runId: input.runId,
          sequence,
          question,
        }
        await tx.agentEvent.create({
          data: {
            runId: input.runId,
            sequence,
            type: event.type,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        })
        return { question, event }
      })
    } catch (error) {
      if (isUniqueConstraint(error)) throw new AgentUserQuestionAlreadyPendingError()
      throw error
    }
  }

  async findPendingForThreadOwner(
    threadId: string,
    userId: string,
  ): Promise<AgentUserQuestion | null> {
    const row = await this.prisma.agentUserQuestion.findFirst({
      where: {
        status: 'PENDING',
        run: { threadId, userId, status: 'WAITING_FOR_USER' },
      },
      orderBy: { createdAt: 'desc' },
    })
    return row ? toQuestion(row) : null
  }

  async findForOwner(questionId: string, userId: string): Promise<AgentUserQuestion | null> {
    const row = await this.prisma.agentUserQuestion.findFirst({
      where: { id: questionId, run: { userId } },
    })
    return row ? toQuestion(row) : null
  }

  async answer(
    questionId: string,
    userId: string,
    answers: AgentUserQuestionAnswerItem[],
  ): Promise<QuestionWriteResult | null> {
    return this.settle(questionId, userId, 'ANSWERED', answers)
  }

  async skip(questionId: string, userId: string): Promise<QuestionWriteResult | null> {
    return this.settle(questionId, userId, 'SKIPPED', [])
  }

  async cancelPendingForRun(runId: string): Promise<number> {
    const settledAt = new Date()
    const result = await this.prisma.agentUserQuestion.updateMany({
      where: { runId, status: 'PENDING' },
      data: { status: 'CANCELLED', settledAt },
    })
    return result.count
  }

  private async settle(
    questionId: string,
    userId: string,
    status: 'ANSWERED' | 'SKIPPED',
    answers: AgentUserQuestionAnswerItem[],
  ): Promise<QuestionWriteResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.agentUserQuestion.findFirst({
        where: { id: questionId, run: { userId } },
        include: { run: true },
      })
      if (!initial) return null
      if (initial.status !== 'PENDING') {
        return { question: toQuestion(initial), event: null, settledNow: false }
      }
      if (initial.run.status !== 'WAITING_FOR_USER') {
        const invalidStatus = initial.run.status === 'CANCELLED' ? 'CANCELLED' : 'INTERRUPTED'
        const settledAt = initial.settledAt ?? new Date()
        await tx.agentUserQuestion.updateMany({
          where: { id: questionId, status: 'PENDING' },
          data: { status: invalidStatus, settledAt },
        })
        return {
          question: toQuestion({ ...initial, status: invalidStatus, settledAt }),
          event: null,
          settledNow: false,
        }
      }

      const settledAt = new Date()
      const claim = await tx.agentUserQuestion.updateMany({
        where: { id: questionId, status: 'PENDING' },
        data: { status, settledAt },
      })
      if (claim.count === 0) {
        const winner = await tx.agentUserQuestion.findUniqueOrThrow({ where: { id: questionId } })
        return { question: toQuestion(winner), event: null, settledNow: false }
      }

      if (status === 'ANSWERED') {
        await tx.agentUserQuestionAnswer.createMany({
          data: answers.map((answer) => ({
            userQuestionId: questionId,
            questionItemId: answer.questionId,
            optionIds: answer.selectedOptionIds,
            customText: answer.customText ?? null,
          })),
        })
      }

      const sequence = initial.run.lastSequence + 1
      await tx.agentRun.update({
        where: { id: initial.runId },
        data: { status: 'RUNNING', lastSequence: sequence },
      })
      const event: AgentStreamEvent =
        status === 'ANSWERED'
          ? {
              type: 'user-question-answered',
              runId: initial.runId,
              sequence,
              questionId,
              answers,
            }
          : {
              type: 'user-question-skipped',
              runId: initial.runId,
              sequence,
              questionId,
            }
      await tx.agentEvent.create({
        data: {
          runId: initial.runId,
          sequence,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      })
      return {
        question: toQuestion({ ...initial, status, settledAt }),
        event,
        settledNow: true,
      }
    })
  }
}

function toQuestion(row: {
  id: string
  runId: string
  status: string
  questions: Prisma.JsonValue
  createdAt: Date
  settledAt: Date | null
}): AgentUserQuestion {
  return {
    id: row.id,
    runId: row.runId,
    status: row.status.toLowerCase() as AgentUserQuestion['status'],
    questions: row.questions as unknown as AgentUserQuestion['questions'],
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
