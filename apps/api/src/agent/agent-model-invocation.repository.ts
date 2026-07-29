import { Inject, Injectable } from '@nestjs/common'

import {
  AgentInvocationAttributionKind,
  AgentInvocationStatus,
  Prisma,
} from '../generated/prisma/client'
import { PrismaService } from '../database/prisma.service'
import type { ChatAdapterUsage } from '../chat/adapters/chat-adapter'

export interface SaveAgentModelInvocationInput {
  requestId: string
  requestLogId: string
  agentRunId: string
  userId: string
  status: 'succeeded' | 'failed' | 'cancelled'
  provider?: string
  resolvedModel?: string
  usage: ChatAdapterUsage
  startedAt: Date
  completedAt: Date
  skillNames: readonly string[]
  toolNames: readonly string[]
}

const STATUS_MAP = {
  succeeded: AgentInvocationStatus.SUCCEEDED,
  failed: AgentInvocationStatus.FAILED,
  cancelled: AgentInvocationStatus.CANCELLED,
} as const

@Injectable()
export class AgentModelInvocationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async save(input: SaveAgentModelInvocationInput): Promise<void> {
    const cacheUsageAvailable = input.usage.cachedInputTokens != null
    const reasoningUsageAvailable = input.usage.reasoningTokens != null
    await this.prisma.$transaction(async (tx) => {
      const invocation = await tx.agentModelInvocation.upsert({
        where: { requestId: input.requestId },
        create: {
          requestId: input.requestId,
          requestLogId: input.requestLogId,
          agentRunId: input.agentRunId,
          userId: input.userId,
          status: STATUS_MAP[input.status],
          provider: input.provider ?? null,
          resolvedModel: input.resolvedModel ?? null,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.totalTokens,
          cachedInputTokens: input.usage.cachedInputTokens ?? null,
          reasoningTokens: input.usage.reasoningTokens ?? null,
          usageUnknown: input.usage.usageUnknown,
          cacheUsageAvailable,
          reasoningUsageAvailable,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
        update: {
          status: STATUS_MAP[input.status],
          provider: input.provider ?? null,
          resolvedModel: input.resolvedModel ?? null,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.totalTokens,
          cachedInputTokens: input.usage.cachedInputTokens ?? null,
          reasoningTokens: input.usage.reasoningTokens ?? null,
          usageUnknown: input.usage.usageUnknown,
          cacheUsageAvailable,
          reasoningUsageAvailable,
          completedAt: input.completedAt,
        },
      })
      await this.replaceAttributions(tx, invocation.id, 'SKILL', input.skillNames)
      await this.replaceAttributions(tx, invocation.id, 'TOOL', input.toolNames)
    })
  }

  private async replaceAttributions(
    tx: Prisma.TransactionClient,
    invocationId: string,
    kind: 'SKILL' | 'TOOL',
    names: readonly string[],
  ): Promise<void> {
    const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort()
    await tx.agentModelInvocationAttribution.deleteMany({
      where: {
        invocationId,
        kind: AgentInvocationAttributionKind[kind],
      },
    })
    if (normalized.length === 0) return
    const weight = new Prisma.Decimal(1).div(normalized.length)
    await tx.agentModelInvocationAttribution.createMany({
      data: normalized.map((name) => ({
        invocationId,
        kind: AgentInvocationAttributionKind[kind],
        name,
        weight,
      })),
    })
  }
}
