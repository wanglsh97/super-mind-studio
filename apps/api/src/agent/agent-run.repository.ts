import type { AgentStreamEvent } from '@supermind/sdk'
import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../generated/prisma/client'
import type {
  AgentRun,
  AgentRunLimitReason,
  AgentRunStatus,
  AgentToolCallStatus,
} from '../generated/prisma/client'
import { PrismaService } from '../database/prisma.service'
import type { ProjectedToolCall } from './agent-run.projector'
import type { AgentPromptManifest } from './prompt/agent-prompt.composer'

const TOOL_CALL_STATUS_MAP: Record<ProjectedToolCall['status'], AgentToolCallStatus> = {
  running: 'RUNNING',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
}

export interface CreateAgentRunInput {
  threadId: string
  userId: string
  input: string
}

export interface FinalizeAgentRunInput {
  status: AgentRunStatus
  limitReason?: AgentRunLimitReason | null
  lastSequence: number
  modelCallCount: number
  toolCallCount: number
  webFetchCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  usageUnknown: boolean
  estimatedCostCny?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  completedAt?: Date
}

/** 未终结（进行中）的 run 状态。 */
export const ACTIVE_AGENT_RUN_STATUSES = [
  'RUNNING',
  'CANCELLING',
] as const satisfies readonly AgentRunStatus[]

/**
 * AgentRun 持久化端口。
 *
 * 与 AgentThread 一致，所有读取与变更以 `userId` 过滤；run 关联的 thread 必须同属该用户。
 */
@Injectable()
export class AgentRunRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateAgentRunInput): Promise<AgentRun> {
    return this.prisma.agentRun.create({
      data: {
        threadId: input.threadId,
        userId: input.userId,
        input: input.input,
      },
    })
  }

  async findForOwner(runId: string, userId: string): Promise<AgentRun | null> {
    return this.prisma.agentRun.findFirst({ where: { id: runId, userId } })
  }

  async listEventsAfter(
    runId: string,
    after: number,
  ): Promise<{ sequence: number; payload: unknown }[]> {
    return this.prisma.agentEvent.findMany({
      where: { runId, sequence: { gt: after } },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, payload: true },
    })
  }

  async findActiveForUser(userId: string): Promise<AgentRun | null> {
    return this.prisma.agentRun.findFirst({
      where: { userId, status: { in: [...ACTIVE_AGENT_RUN_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findActiveForThread(threadId: string): Promise<AgentRun | null> {
    return this.prisma.agentRun.findFirst({
      where: { threadId, status: { in: [...ACTIVE_AGENT_RUN_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async countActiveForUser(userId: string): Promise<number> {
    return this.prisma.agentRun.count({
      where: { userId, status: { in: [...ACTIVE_AGENT_RUN_STATUSES] } },
    })
  }

  async updateStatus(runId: string, data: Prisma.AgentRunUpdateInput): Promise<void> {
    await this.prisma.agentRun.update({ where: { id: runId }, data })
  }

  async markStarted(runId: string, startedAt = new Date()): Promise<void> {
    await this.prisma.agentRun.update({ where: { id: runId }, data: { startedAt } })
  }

  async markSandboxReady(
    runId: string,
    sandboxId: string,
    sandboxStartedAt = new Date(),
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { sandboxId, sandboxStartedAt },
    })
  }

  async savePromptAudit(runId: string, manifest: AgentPromptManifest): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        promptProfileVersion: manifest.profileVersion,
        promptHash: manifest.promptHash,
        promptManifest: manifest as unknown as Prisma.InputJsonValue,
      },
    })
  }

  /** 追加事件（幂等按 (runId, sequence) 唯一约束跳过重复），并推进 lastSequence。 */
  async appendEvents(runId: string, events: readonly AgentStreamEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.prisma.agentEvent.createMany({
      data: events.map((event) => ({
        runId,
        sequence: event.sequence,
        type: event.type,
        // Agent 事件线协议即 AgentStreamEvent 的 camelCase JSON，直接落库无需运行时依赖 SDK 编解码。
        payload: event as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
    const lastSequence = events.reduce((max, event) => Math.max(max, event.sequence), -1)
    await this.prisma.agentRun.updateMany({
      where: { id: runId, lastSequence: { lt: lastSequence } },
      data: { lastSequence },
    })
  }

  async saveToolCalls(runId: string, records: readonly ProjectedToolCall[]): Promise<void> {
    for (const record of records) {
      const data = {
        status: TOOL_CALL_STATUS_MAP[record.status],
        summary: record.summary,
        audit: (record.audit ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        errorCode:
          record.isError && typeof record.audit?.code === 'string' ? record.audit.code : null,
        errorMessage: record.isError ? record.summary : null,
        completedAt: new Date(),
      }
      const saved = await this.prisma.agentToolCall.upsert({
        where: { runId_toolCallId: { runId, toolCallId: record.toolCallId } },
        create: {
          runId,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          args: record.args as Prisma.InputJsonValue,
          ...data,
        },
        update: data,
      })
      const fileId =
        record.toolName === 'export_file' && typeof record.audit?.fileId === 'string'
          ? record.audit.fileId
          : undefined
      if (fileId) {
        await this.prisma.userFile.updateMany({
          where: { id: fileId, runId },
          data: { sourceToolCallId: saved.id },
        })
      }
    }
  }

  async finalize(runId: string, input: FinalizeAgentRunInput): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        limitReason: input.limitReason ?? null,
        lastSequence: input.lastSequence,
        modelCallCount: input.modelCallCount,
        toolCallCount: input.toolCallCount,
        webFetchCount: input.webFetchCount,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        usageUnknown: input.usageUnknown,
        estimatedCostCny: input.estimatedCostCny ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        completedAt: input.completedAt ?? new Date(),
      },
    })
  }

  /** API 启动清理：把遗留 running/cancelling run 标记为 interrupted，并写入终态事件。 */
  async interruptAbandonedRuns(): Promise<{ count: number; runIds: string[] }> {
    const abandoned = await this.prisma.agentRun.findMany({
      where: { status: { in: [...ACTIVE_AGENT_RUN_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    })
    if (abandoned.length === 0) return { count: 0, runIds: [] }

    for (const run of abandoned) {
      const sequence = run.lastSequence + 1
      await this.appendEvents(run.id, [
        {
          type: 'run-terminal',
          sequence,
          runId: run.id,
          status: 'interrupted',
          limitReason: null,
        },
      ])
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'INTERRUPTED',
          lastSequence: sequence,
          completedAt: new Date(),
          errorCode: 'AGENT_INTERRUPTED',
          errorMessage: '服务重启导致运行中断，未自动重放模型或工具',
        },
      })
    }

    return { count: abandoned.length, runIds: abandoned.map((run) => run.id) }
  }

  async findLatestForThread(threadId: string): Promise<AgentRun | null> {
    return this.prisma.agentRun.findFirst({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
