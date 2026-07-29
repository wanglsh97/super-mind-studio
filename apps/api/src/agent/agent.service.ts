import type {
  AgentRunSummary,
  AgentThinkingEffort,
  AgentThread,
  AgentThreadListPage,
  AgentThreadSummary,
} from '@supermind/sdk'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'

import { ChatModelCatalog } from '../chat/chat-model-catalog'
import type { AgentRun } from '../generated/prisma/client'
import type { AuthenticatedUser } from '../user-auth/user-session.service'
import { AgentActiveRunLock } from './agent-active-run.lock'
import { AgentContextSummaryRepository } from './context/agent-context-summary.repository'
import {
  AGENT_DEFAULT_THREAD_TITLE,
  AGENT_THREAD_LIST_DEFAULT_PAGE,
  AGENT_THREAD_LIST_DEFAULT_PAGE_SIZE,
} from './agent.constants'
import { AgentMessageRepository } from './agent-message.repository'
import {
  AgentRunRepository,
  AgentThreadActiveRunError,
  AgentUserConcurrencyLimitError,
} from './agent-run.repository'
import { AgentRunService } from './agent-run.service'
import { deriveAgentThreadTitle } from './agent-title'
import { AgentThreadRepository } from './agent-thread.repository'
import {
  toContextSummary,
  toMessage,
  toRunSummary,
  toThreadSandbox,
  toThreadSummary,
} from './agent.mappers'
import { AgentExecutionSessionService } from './sandbox/agent-execution-session.service'

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name)

  constructor(
    @Inject(AgentThreadRepository) private readonly threads: AgentThreadRepository,
    @Inject(AgentRunRepository) private readonly runs: AgentRunRepository,
    @Inject(AgentMessageRepository) private readonly messages: AgentMessageRepository,
    @Inject(ChatModelCatalog) private readonly models: ChatModelCatalog,
    @Inject(AgentRunService) private readonly runService: AgentRunService,
    @Inject(AgentActiveRunLock) private readonly activeRunLock: AgentActiveRunLock,
    @Inject(AgentContextSummaryRepository)
    private readonly contextSummaries: AgentContextSummaryRepository,
    @Inject(AgentExecutionSessionService)
    private readonly executionSessions: AgentExecutionSessionService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async createThread(
    user: AuthenticatedUser,
    input: { model: string; title?: string },
  ): Promise<AgentThreadSummary> {
    const model = this.models.resolveForAgent(input.model)
    if (!model) {
      throw new BadRequestException(
        `未知、未启用或不支持 Agent（tool-calling）的模型 "${input.model}"`,
      )
    }

    const row = await this.threads.create({
      userId: user.id,
      title: input.title?.trim() || AGENT_DEFAULT_THREAD_TITLE,
      modelId: model.id,
      provider: model.provider,
    })
    return toThreadSummary(row)
  }

  async listThreads(
    user: AuthenticatedUser,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<AgentThreadListPage> {
    const page = query.page ?? AGENT_THREAD_LIST_DEFAULT_PAGE
    const pageSize = query.pageSize ?? AGENT_THREAD_LIST_DEFAULT_PAGE_SIZE
    const [{ rows, total }, activeRuns] = await Promise.all([
      this.threads.listForOwner(user.id, {
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.runs.listActiveForUser(user.id),
    ])
    return {
      items: rows.map(toThreadSummary),
      page,
      pageSize,
      total,
      pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
      activeRuns: activeRuns.map(toRunSummary),
    }
  }

  async getThread(user: AuthenticatedUser, threadId: string): Promise<AgentThread> {
    const summary = await this.threads.findSummaryForOwner(threadId, user.id)
    if (!summary) throw new NotFoundException('Agent 会话不存在')

    const [messages, activeRun, lastRun, contextSummary] = await Promise.all([
      this.messages.listForThread(threadId),
      this.runs.findActiveForThread(threadId),
      this.runs.findLatestForThread(threadId),
      this.contextSummaries.findForThread(threadId),
    ])

    return {
      ...toThreadSummary(summary),
      messages: messages.map(toMessage),
      activeRun: activeRun ? toRunSummary(activeRun) : null,
      lastRun: lastRun ? toRunSummary(lastRun) : null,
      contextSummary: contextSummary ? toContextSummary(contextSummary) : null,
      sandbox: toThreadSandbox(summary),
    }
  }

  async renameThread(
    user: AuthenticatedUser,
    threadId: string,
    title: string,
  ): Promise<AgentThreadSummary> {
    const trimmed = title.trim()
    if (!trimmed) throw new BadRequestException('会话标题不能为空')

    const updated = await this.threads.renameForOwner(threadId, user.id, trimmed)
    if (!updated) throw new NotFoundException('Agent 会话不存在')
    const summary = await this.threads.findSummaryForOwner(threadId, user.id)
    if (!summary) throw new NotFoundException('Agent 会话不存在')
    return toThreadSummary(summary)
  }

  async deleteThread(user: AuthenticatedUser, threadId: string): Promise<void> {
    const summary = await this.threads.findSummaryForOwner(threadId, user.id)
    if (!summary) throw new NotFoundException('Agent 会话不存在')

    const activeRun = await this.runs.findActiveForThread(threadId)
    if (activeRun) throw new ConflictException('该会话存在进行中的运行，无法删除')

    await this.executionSessions.destroyThread(threadId)
    // Prisma 级联删除 messages/runs/events/toolCalls；RequestLog.agentRunId 为 SetNull，账单保留。
    const deleted = await this.threads.deleteForOwner(threadId, user.id)
    if (!deleted) throw new NotFoundException('Agent 会话不存在')
  }

  async createRun(
    user: AuthenticatedUser,
    threadId: string,
    input: string,
    skills: readonly { name: string }[] = [],
    thinkingEffort: AgentThinkingEffort = 'balanced',
  ): Promise<AgentRunSummary> {
    const thread = await this.threads.findSummaryForOwner(threadId, user.id)
    if (!thread) throw new NotFoundException('Agent 会话不存在')

    const model = this.models.resolve(thread.modelId)
    if (!model) {
      throw new BadRequestException(`会话绑定的模型 "${thread.modelId}" 当前不可用`)
    }

    // 同一 Thread 仍严格互斥；不同 Thread 可在用户上限内并行。
    const existing = await this.runs.findActiveForThread(threadId)
    if (existing) throw this.activeRunLock.threadConflict(existing.id)

    // Redis Thread 原子锁：快速互斥；不可用时 fail closed。
    const lockToken = randomUUID()
    const acquired = await this.activeRunLock.tryAcquire(threadId, lockToken)
    if (!acquired) {
      const raced = await this.runs.findActiveForThread(threadId)
      throw this.activeRunLock.threadConflict(raced?.id)
    }

    try {
      const run = await this.runs.admit({
        threadId,
        userId: user.id,
        input,
        maxConcurrentRuns: this.config.get<number>('AGENT_MAX_CONCURRENT_RUNS_PER_USER', 3),
        ...(thread.title === AGENT_DEFAULT_THREAD_TITLE
          ? { derivedTitle: deriveAgentThreadTitle(input) }
          : {}),
      })

      void this.runService
        .execute({
          runId: run.id,
          threadId,
          userId: user.id,
          modelId: model.id,
          provider: model.provider,
          contextWindowTokens: model.contextWindowTokens,
          input,
          thinkingEffort,
          selectedSkillNames: skills.map((skill) => skill.name),
          activeRunLockToken: lockToken,
        })
        .catch((error) => this.logger.error({ error, runId: run.id }, 'Agent run execution failed'))

      return toRunSummary(run)
    } catch (error) {
      await this.activeRunLock.release(threadId, lockToken)
      if (error instanceof AgentThreadActiveRunError) {
        throw this.activeRunLock.threadConflict(error.activeRunId)
      }
      if (error instanceof AgentUserConcurrencyLimitError) {
        throw this.activeRunLock.userLimit(error.limit)
      }
      throw error
    }
  }

  async assertRunOwner(user: AuthenticatedUser, runId: string): Promise<AgentRun> {
    const run = await this.runs.findForOwner(runId, user.id)
    if (!run) throw new NotFoundException('Agent 运行不存在')
    return run
  }

  async cancelRun(user: AuthenticatedUser, runId: string): Promise<AgentRunSummary> {
    const run = await this.assertRunOwner(user, runId)
    this.runService.cancel(runId)
    return toRunSummary(run)
  }
}
