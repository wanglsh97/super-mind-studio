import type {
  AgentRunSummary,
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
import { AgentRunRepository } from './agent-run.repository'
import { AgentRunService } from './agent-run.service'
import { deriveAgentThreadTitle } from './agent-title'
import { AgentThreadRepository } from './agent-thread.repository'
import { toContextSummary, toMessage, toRunSummary, toThreadSummary } from './agent.mappers'

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
    const [{ rows, total }, activeRun] = await Promise.all([
      this.threads.listForOwner(user.id, {
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.runs.findActiveForUser(user.id),
    ])
    return {
      items: rows.map(toThreadSummary),
      page,
      pageSize,
      total,
      pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
      activeRun: activeRun ? toRunSummary(activeRun) : null,
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

    // Prisma 级联删除 messages/runs/events/toolCalls；RequestLog.agentRunId 为 SetNull，账单保留。
    const deleted = await this.threads.deleteForOwner(threadId, user.id)
    if (!deleted) throw new NotFoundException('Agent 会话不存在')
  }

  async createRun(
    user: AuthenticatedUser,
    threadId: string,
    input: string,
    skills: readonly { name: string }[] = [],
  ): Promise<AgentRunSummary> {
    const thread = await this.threads.findSummaryForOwner(threadId, user.id)
    if (!thread) throw new NotFoundException('Agent 会话不存在')

    const model = this.models.resolve(thread.modelId)
    if (!model) {
      throw new BadRequestException(`会话绑定的模型 "${thread.modelId}" 当前不可用`)
    }

    // PostgreSQL 真源：已有 active run 则拒绝（跨 thread 全局）。
    const existing = await this.runs.findActiveForUser(user.id)
    if (existing) throw this.activeRunLock.conflict(existing.id)

    // Redis 原子锁：快速互斥；不可用时 fail closed。
    const lockToken = randomUUID()
    const acquired = await this.activeRunLock.tryAcquire(user.id, lockToken)
    if (!acquired) {
      const raced = await this.runs.findActiveForUser(user.id)
      throw this.activeRunLock.conflict(raced?.id)
    }

    try {
      // 持锁后再核一次，避免与锁过期窗口竞态。
      const stillActive = await this.runs.findActiveForUser(user.id)
      if (stillActive) throw this.activeRunLock.conflict(stillActive.id)

      const run = await this.runs.create({ threadId, userId: user.id, input })
      await this.messages.appendUserMessage(threadId, run.id, input)
      if (thread.title === AGENT_DEFAULT_THREAD_TITLE) {
        await this.threads.renameForOwner(threadId, user.id, deriveAgentThreadTitle(input))
      }

      void this.runService
        .execute({
          runId: run.id,
          threadId,
          userId: user.id,
          modelId: model.id,
          provider: model.provider,
          contextWindowTokens: model.contextWindowTokens,
          input,
          selectedSkillNames: skills.map((skill) => skill.name),
          activeRunLockToken: lockToken,
        })
        .catch((error) => this.logger.error({ error, runId: run.id }, 'Agent run execution failed'))

      return toRunSummary(run)
    } catch (error) {
      await this.activeRunLock.release(user.id, lockToken)
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
