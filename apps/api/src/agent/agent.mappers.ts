import type {
  AgentMessage,
  AgentMessagePart,
  AgentMessageRole,
  AgentRunLimitReason,
  AgentRunStatus,
  AgentRunSummary,
  AgentThreadSummary,
  AgentContextSummary as AgentContextSummaryDto,
} from '@supermind/sdk'

import type {
  AgentMessage as AgentMessageRow,
  AgentMessageRole as PrismaMessageRole,
  AgentRun,
  AgentContextSummary,
  AgentRunLimitReason as PrismaLimitReason,
  AgentRunStatus as PrismaRunStatus,
} from '../generated/prisma/client'
import type { AgentThreadSummaryRow } from './agent-thread.repository'

const RUN_STATUS_MAP: Record<PrismaRunStatus, AgentRunStatus> = {
  RUNNING: 'running',
  CANCELLING: 'cancelling',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  LIMIT_REACHED: 'limit_reached',
  INTERRUPTED: 'interrupted',
}

const LIMIT_REASON_MAP: Record<PrismaLimitReason, AgentRunLimitReason> = {
  MODEL_CALLS: 'model_calls',
  TOOL_CALLS: 'tool_calls',
  WEB_FETCH_CALLS: 'web_fetch_calls',
  DURATION: 'duration',
  CONTEXT_WINDOW: 'context_window',
  SANDBOX_DURATION: 'sandbox_duration',
  SHELL_CALLS: 'shell_calls',
  SANDBOX_OUTPUT: 'sandbox_output',
  SANDBOX_EGRESS: 'sandbox_egress',
  SANDBOX_RESOURCE: 'sandbox_resource',
}

const MESSAGE_ROLE_MAP: Record<PrismaMessageRole, AgentMessageRole> = {
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
}

export function toThreadSummary(row: AgentThreadSummaryRow): AgentThreadSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.modelId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toRunSummary(run: AgentRun): AgentRunSummary {
  return {
    id: run.id,
    threadId: run.threadId,
    status: RUN_STATUS_MAP[run.status],
    limitReason: run.limitReason ? LIMIT_REASON_MAP[run.limitReason] : null,
    usage: {
      inputTokens: run.usageUnknown ? null : run.inputTokens,
      outputTokens: run.usageUnknown ? null : run.outputTokens,
      totalTokens: run.usageUnknown ? null : run.totalTokens,
      estimatedCostCny: run.estimatedCostCny ? run.estimatedCostCny.toString() : null,
      usageUnknown: run.usageUnknown,
      modelCalls: run.modelCallCount,
      toolCalls: run.toolCallCount,
      webFetchCalls: run.webFetchCount,
    },
    lastSequence: run.lastSequence,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  }
}

export function toMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    role: MESSAGE_ROLE_MAP[row.role],
    parts: (row.parts as unknown as AgentMessagePart[]) ?? [],
    createdAt: row.createdAt.toISOString(),
  }
}

export function toContextSummary(row: AgentContextSummary): AgentContextSummaryDto {
  return {
    id: row.id,
    revision: row.revision,
    coveredThroughSequence: row.coveredThroughSequence,
    schemaVersion: row.schemaVersion,
    modelId: row.modelId,
    content: row.content as unknown as AgentContextSummaryDto['content'],
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    updatedAt: row.updatedAt.toISOString(),
  }
}
