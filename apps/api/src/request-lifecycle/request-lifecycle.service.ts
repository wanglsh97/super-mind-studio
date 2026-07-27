import type { Capability } from '@supermind/sdk'
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

import { Prisma, RequestCapability, RequestStatus } from '../generated/prisma/client'
import type { RequestLog } from '../generated/prisma/client'
import { PrismaService } from '../database/prisma.service'

const REQUEST_CAPABILITY_MAP = {
  chat: RequestCapability.CHAT,
  image: RequestCapability.IMAGE,
  prompt: RequestCapability.PROMPT,
  agent: RequestCapability.AGENT,
} as const satisfies Record<Capability, RequestCapability>

export interface StartRequestLifecycleInput {
  userId: string
  requestId: string
  capability: Capability
  prompt: Prisma.InputJsonValue
  modelAlias: string
  stream: boolean
  provider?: string
  resolvedModel?: string
  clientIp?: string
  metadata?: Prisma.InputJsonValue
  agentRunId?: string
}

export type StartedRequestLifecycle = Pick<RequestLog, 'id' | 'requestId' | 'status' | 'startedAt'>
export type StalePendingRequest = Pick<
  RequestLog,
  'id' | 'requestId' | 'capability' | 'modelAlias' | 'provider' | 'startedAt' | 'createdAt'
>

export type RequestLifecycleTerminalStatus = 'succeeded' | 'failed' | 'cancelled'

export interface RequestLifecycleUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  usageUnknown: boolean
  priceVersion?: string
  inputCostCny?: string
  outputCostCny?: string
  estimatedCostCny?: string
}

export interface RequestLifecycleError {
  code: string
  message: string
  details?: Prisma.InputJsonValue
}

export interface FinishRequestLifecycleInput {
  requestLogId: string
  requestId: string
  startedAt: Date
  status: RequestLifecycleTerminalStatus
  completedAt?: Date
  firstTokenAt?: Date
  providerRequestId?: string
  usage?: RequestLifecycleUsage
  error?: RequestLifecycleError
  provider?: string
  resolvedModel?: string
  failover?: {
    from: string
    to: string
    reason: string
  }
}

export class RequestLifecycleStartError extends ServiceUnavailableException {
  constructor(cause: unknown) {
    super('请求记录创建失败，暂不能调用模型', { cause })
  }
}

export class RequestLifecycleTransitionError extends Error {
  constructor(readonly requestLogId: string) {
    super(`Request lifecycle "${requestLogId}" is not pending`)
    this.name = 'RequestLifecycleTransitionError'
  }
}

export class RequestLifecycleFinishError extends ServiceUnavailableException {
  constructor(cause: unknown) {
    super('请求终结记录写入失败', { cause })
  }
}

const TERMINAL_STATUS_MAP = {
  succeeded: RequestStatus.SUCCEEDED,
  failed: RequestStatus.FAILED,
  cancelled: RequestStatus.CANCELLED,
} as const satisfies Record<RequestLifecycleTerminalStatus, RequestStatus>

@Injectable()
export class RequestLifecycleService {
  private readonly logger = new Logger(RequestLifecycleService.name)

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listStalePending(olderThan: Date, take = 100): Promise<StalePendingRequest[]> {
    if (Number.isNaN(olderThan.getTime())) throw new TypeError('olderThan must be a valid date')
    if (!Number.isInteger(take) || take < 1 || take > 200) {
      throw new TypeError('take must be an integer between 1 and 200')
    }

    return this.prisma.requestLog.findMany({
      where: { status: RequestStatus.PENDING, startedAt: { lte: olderThan } },
      orderBy: { startedAt: 'asc' },
      take,
      select: {
        id: true,
        requestId: true,
        capability: true,
        modelAlias: true,
        provider: true,
        startedAt: true,
        createdAt: true,
      },
    })
  }

  async start(input: StartRequestLifecycleInput): Promise<StartedRequestLifecycle> {
    try {
      const started = await this.prisma.requestLog.create({
        data: {
          userId: input.userId,
          requestId: input.requestId,
          capability: REQUEST_CAPABILITY_MAP[input.capability],
          prompt: input.prompt,
          modelAlias: input.modelAlias,
          stream: input.stream,
          status: RequestStatus.PENDING,
          ...(input.provider === undefined ? {} : { provider: input.provider }),
          ...(input.resolvedModel === undefined ? {} : { resolvedModel: input.resolvedModel }),
          ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          ...(input.agentRunId === undefined ? {} : { agentRunId: input.agentRunId }),
        },
        select: {
          id: true,
          requestId: true,
          status: true,
          startedAt: true,
        },
      })
      this.logger.log(
        {
          event: 'request.lifecycle.started',
          requestLogId: started.id,
          userId: input.userId,
          requestId: input.requestId,
          capability: input.capability,
          model: input.modelAlias,
          provider: input.provider ?? null,
          resolvedModel: input.resolvedModel ?? null,
          stream: input.stream,
          prompt: input.prompt,
        },
        'Request lifecycle started',
      )
      return started
    } catch (error) {
      this.logger.error(
        { error, requestId: input.requestId, capability: input.capability },
        'Failed to create pending request log',
      )
      throw new RequestLifecycleStartError(error)
    }
  }

  async finish(input: FinishRequestLifecycleInput): Promise<void> {
    const completedAt = input.completedAt ?? new Date()
    const durationMs = Math.max(0, completedAt.getTime() - input.startedAt.getTime())
    const usage = input.usage ?? {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageUnknown: true,
    }
    const billingData = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      usageUnknown: usage.usageUnknown,
      priceVersion: usage.priceVersion ?? null,
      inputCostCny: usage.inputCostCny ?? null,
      outputCostCny: usage.outputCostCny ?? null,
      estimatedCostCny: usage.estimatedCostCny ?? null,
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.requestLog.updateMany({
          where: { id: input.requestLogId, status: RequestStatus.PENDING },
          data: {
            status: TERMINAL_STATUS_MAP[input.status],
            completedAt,
            durationMs,
            firstTokenAt: input.firstTokenAt ?? null,
            providerRequestId: input.providerRequestId ?? null,
            ...(input.provider === undefined ? {} : { provider: input.provider }),
            ...(input.resolvedModel === undefined ? {} : { resolvedModel: input.resolvedModel }),
            failoverFrom: input.failover?.from ?? null,
            failoverTo: input.failover?.to ?? null,
            failoverReason: input.failover?.reason ?? null,
            errorCode: input.error?.code ?? null,
            errorMessage: input.error?.message ?? null,
            errorDetails: input.error?.details ?? Prisma.DbNull,
          },
        })

        if (updated.count !== 1) throw new RequestLifecycleTransitionError(input.requestLogId)

        await transaction.billingRecord.upsert({
          where: { requestLogId: input.requestLogId },
          create: { requestLogId: input.requestLogId, ...billingData },
          update: billingData,
        })
      })
      this.logger.log(
        {
          event: 'request.lifecycle.finished',
          requestLogId: input.requestLogId,
          requestId: input.requestId,
          status: input.status,
          durationMs,
          ttfbMs:
            input.firstTokenAt === undefined
              ? null
              : Math.max(0, input.firstTokenAt.getTime() - input.startedAt.getTime()),
          provider: input.provider ?? null,
          resolvedModel: input.resolvedModel ?? null,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            usageUnknown: usage.usageUnknown,
          },
          cost: {
            priceVersion: usage.priceVersion ?? null,
            inputCostCny: usage.inputCostCny ?? null,
            outputCostCny: usage.outputCostCny ?? null,
            estimatedCostCny: usage.estimatedCostCny ?? null,
          },
          failover: input.failover ?? null,
          error: input.error ?? null,
        },
        'Request lifecycle finished',
      )
    } catch (error) {
      if (error instanceof RequestLifecycleTransitionError) throw error
      this.logger.error(
        { error, requestId: input.requestId, status: input.status },
        'Failed to finalize request lifecycle',
      )
      throw new RequestLifecycleFinishError(error)
    }
  }
}
