import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common'

import type { ChatModelCatalog } from '../chat/chat-model-catalog'
import type { ConfigService } from '@nestjs/config'
import type { AuthenticatedUser } from '../user-auth/user-session.service'
import type { AgentActiveRunLock } from './agent-active-run.lock'
import type { AgentContextSummaryRepository } from './context/agent-context-summary.repository'
import type { AgentMessageRepository } from './agent-message.repository'
import { AgentUserConcurrencyLimitError, type AgentRunRepository } from './agent-run.repository'
import type { AgentRunService } from './agent-run.service'
import type { AgentThreadRepository } from './agent-thread.repository'
import type { AgentExecutionSessionService } from './sandbox/agent-execution-session.service'
import { AgentService } from './agent.service'

const user: AuthenticatedUser = {
  id: 'user-a',
  authProvider: 'GITHUB',
  userName: 'octocat',
  avatarUrl: null,
}

function setup() {
  const threads = {
    create: jest.fn(),
    listForOwner: jest.fn(),
    findSummaryForOwner: jest.fn(),
    renameForOwner: jest.fn(),
    deleteForOwner: jest.fn(),
  } as unknown as jest.Mocked<AgentThreadRepository>
  const runs = {
    create: jest.fn(),
    admit: jest.fn(),
    findForOwner: jest.fn(),
    findActiveForThread: jest.fn(),
    findActiveForUser: jest.fn().mockResolvedValue(null),
    listActiveForUser: jest.fn().mockResolvedValue([]),
    findLatestForThread: jest.fn().mockResolvedValue(null),
    countActiveForUser: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<AgentRunRepository>
  const messages = {
    listForThread: jest.fn().mockResolvedValue([]),
    appendUserMessage: jest.fn(),
  } as unknown as jest.Mocked<AgentMessageRepository>
  const models = {
    resolve: jest.fn(),
    resolveForAgent: jest.fn(),
  } as unknown as jest.Mocked<ChatModelCatalog>
  const runService = {
    execute: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn(),
  } as unknown as jest.Mocked<AgentRunService>
  const activeRunLock = {
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    threadConflict: jest.fn(
      (activeRunId?: string) =>
        new ConflictException({
          message: '已有进行中的 Agent 运行，请等待其结束',
          details:
            activeRunId === undefined
              ? { code: 'AGENT_ACTIVE_RUN' }
              : { code: 'AGENT_THREAD_ACTIVE_RUN', activeRunId },
        }),
    ),
    userLimit: jest.fn(
      (limit: number) =>
        new ConflictException({
          message: `已达到同时运行 ${limit} 个 Agent 的上限`,
          details: { code: 'AGENT_USER_CONCURRENCY_LIMIT', limit },
        }),
    ),
  } as unknown as jest.Mocked<AgentActiveRunLock>
  const contextSummaries = {
    findForThread: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<AgentContextSummaryRepository>
  const executionSessions = {
    destroyThread: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AgentExecutionSessionService>
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  } as unknown as ConfigService
  const service = new AgentService(
    threads,
    runs,
    messages,
    models,
    runService,
    activeRunLock,
    contextSummaries,
    executionSessions,
    config,
  )
  return {
    threads,
    runs,
    messages,
    models,
    runService,
    activeRunLock,
    executionSessions,
    service,
  }
}

function threadRow(
  overrides: Partial<{ id: string; title: string; modelId: string; provider: string }> = {},
) {
  return {
    id: 'thread-1',
    title: '新的 Agent 会话',
    modelId: 'qwen3.7-plus',
    provider: 'qwen',
    contextWindowTokens: 1_000_000,
    sandboxId: null,
    sandboxStatus: null,
    sandboxCreatedAt: null,
    sandboxLastUsedAt: null,
    sandboxExpiresAt: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...overrides,
  }
}

describe('AgentService', () => {
  it('rejects creating a thread with an unknown or non-agent model', async () => {
    const { service, models, threads } = setup()
    ;(models.resolveForAgent as jest.Mock).mockReturnValue(undefined)
    await expect(service.createThread(user, { model: 'ghost' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(threads.create).not.toHaveBeenCalled()
  })

  it('creates a thread bound to the resolved agent-capable provider', async () => {
    const { service, models, threads } = setup()
    ;(models.resolveForAgent as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'x',
      displayName: 'Q',
    })
    ;(threads.create as jest.Mock).mockResolvedValue(threadRow())
    await service.createThread(user, { model: 'qwen3.7-plus' })
    expect(threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a', modelId: 'qwen3.7-plus', provider: 'qwen' }),
    )
  })

  it('creates a thread with the default title when title is omitted or blank', async () => {
    const { service, models, threads } = setup()
    ;(models.resolveForAgent as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'x',
      displayName: 'Q',
    })
    ;(threads.create as jest.Mock).mockResolvedValue(threadRow())
    await service.createThread(user, { model: 'qwen3.7-plus' })
    await service.createThread(user, { model: 'qwen3.7-plus', title: '   ' })
    expect(threads.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: '新的 Agent 会话' }),
    )
    expect(threads.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: '新的 Agent 会话' }),
    )
  })

  it('lists threads as a paginated page sorted by repository order', async () => {
    const { service, threads, runs } = setup()
    ;(threads.listForOwner as jest.Mock).mockResolvedValue({
      rows: [threadRow({ id: 'newer' }), threadRow({ id: 'older' })],
      total: 2,
    })
    ;(runs.findActiveForUser as jest.Mock).mockResolvedValue(null)
    await expect(service.listThreads(user, { page: 1, pageSize: 20 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'newer' }), expect.objectContaining({ id: 'older' })],
      page: 1,
      pageSize: 20,
      total: 2,
      pageCount: 1,
      activeRuns: [],
    })
    expect(threads.listForOwner).toHaveBeenCalledWith('user-a', { skip: 0, take: 20 })
  })

  it('includes all user active runs on the thread list page', async () => {
    const { service, threads, runs } = setup()
    ;(threads.listForOwner as jest.Mock).mockResolvedValue({ rows: [threadRow()], total: 1 })
    ;(runs.listActiveForUser as jest.Mock).mockResolvedValue([
      {
        id: 'run-live-a',
        threadId: 'thread-1',
        status: 'RUNNING',
        limitReason: null,
        usageUnknown: false,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostCny: null,
        modelCallCount: 0,
        toolCallCount: 0,
        webFetchCount: 0,
        lastSequence: 0,
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        startedAt: new Date('2026-07-20T00:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'run-live-b',
        threadId: 'thread-2',
        status: 'CANCELLING',
        limitReason: null,
        usageUnknown: true,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostCny: null,
        modelCallCount: 1,
        toolCallCount: 0,
        webFetchCount: 0,
        lastSequence: 2,
        createdAt: new Date('2026-07-20T00:01:00.000Z'),
        startedAt: new Date('2026-07-20T00:01:00.000Z'),
        completedAt: null,
      },
    ])
    const page = await service.listThreads(user)
    expect(page.activeRuns).toEqual([
      expect.objectContaining({ id: 'run-live-a', status: 'running' }),
      expect.objectContaining({ id: 'run-live-b', status: 'cancelling' }),
    ])
  })

  it('returns an empty page when the owner has no threads', async () => {
    const { service, threads, runs } = setup()
    ;(threads.listForOwner as jest.Mock).mockResolvedValue({ rows: [], total: 0 })
    ;(runs.findActiveForUser as jest.Mock).mockResolvedValue(null)
    await expect(service.listThreads(user)).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      pageCount: 0,
      activeRuns: [],
    })
  })

  it('returns 404 for a thread owned by another user', async () => {
    const { service, threads } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(null)
    await expect(service.getThread(user, 'thread-x')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns the whole Thread message token estimate against its bound model context window', async () => {
    const { service, threads, messages, models } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(
      threadRow({ modelId: 'qwen3.7-plus' }),
    )
    ;(messages.listForThread as jest.Mock).mockResolvedValue([
      {
        id: 'message-1',
        threadId: 'thread-1',
        runId: 'run-1',
        role: 'USER',
        sequence: 0,
        parts: [{ type: 'text', text: '第一轮问题' }],
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
      },
      {
        id: 'message-2',
        threadId: 'thread-1',
        runId: 'run-1',
        role: 'ASSISTANT',
        sequence: 1,
        parts: [{ type: 'text', text: '第一轮回答' }],
        createdAt: new Date('2026-07-20T00:00:01.000Z'),
      },
    ])
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      contextWindowTokens: 1_000_000,
    })

    const thread = await service.getThread(user, 'thread-1')

    expect(thread.tokenUsage).toEqual({
      totalTokens: expect.any(Number),
      contextWindowTokens: 1_000_000,
      estimated: true,
    })
    expect(thread.tokenUsage.totalTokens).toBeGreaterThan(0)
  })

  it('rejects a second concurrent run in the same thread', async () => {
    const { service, threads, runs, models, activeRunLock, runService } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow({ id: 'thread-a' }))
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'x',
      displayName: 'Q',
    })
    ;(runs.findActiveForThread as jest.Mock).mockResolvedValue({
      id: 'run-a',
      threadId: 'thread-a',
    })
    await expect(service.createRun(user, 'thread-a', '你好')).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(activeRunLock.threadConflict).toHaveBeenCalledWith('run-a')
    expect(activeRunLock.tryAcquire).not.toHaveBeenCalled()
    expect(runs.admit).not.toHaveBeenCalled()
    expect(runService.execute).not.toHaveBeenCalled()
  })

  it('rejects when Redis lock contention occurs without creating a run', async () => {
    const { service, threads, runs, models, activeRunLock } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow())
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'x',
      displayName: 'Q',
    })
    ;(activeRunLock.tryAcquire as jest.Mock).mockResolvedValue(false)
    ;(runs.findActiveForThread as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'run-locked' })
    await expect(service.createRun(user, 'thread-1', 'x')).rejects.toBeInstanceOf(ConflictException)
    expect(activeRunLock.threadConflict).toHaveBeenCalledWith('run-locked')
    expect(runs.admit).not.toHaveBeenCalled()
  })

  it('fails closed when Redis lock acquire throws', async () => {
    const { service, threads, models, runs, activeRunLock } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow())
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'x',
      displayName: 'Q',
    })
    ;(activeRunLock.tryAcquire as jest.Mock).mockRejectedValue(
      new HttpException('Agent 并发锁服务暂时不可用', 503),
    )
    await expect(service.createRun(user, 'thread-1', 'x')).rejects.toBeInstanceOf(HttpException)
    expect(runs.admit).not.toHaveBeenCalled()
  })

  it('atomically admits a run and kicks execution with a Thread lock token', async () => {
    const { service, threads, runs, runService, models, activeRunLock } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow())
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      upstreamModelId: 'x',
      displayName: 'Q',
    })
    ;(runs.admit as jest.Mock).mockResolvedValue({
      id: 'run-1',
      threadId: 'thread-1',
      status: 'RUNNING',
      limitReason: null,
      usageUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCny: null,
      modelCallCount: 0,
      toolCallCount: 0,
      webFetchCount: 0,
      lastSequence: -1,
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      startedAt: null,
      completedAt: null,
    })
    const summary = await service.createRun(user, 'thread-1', '总结 https://a.test')
    expect(summary.id).toBe('run-1')
    expect(summary.status).toBe('running')
    expect(activeRunLock.tryAcquire).toHaveBeenCalledWith('thread-1', expect.any(String))
    expect(runs.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        userId: 'user-a',
        input: '总结 https://a.test',
        maxConcurrentRuns: 3,
      }),
    )
    expect(runService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        threadId: 'thread-1',
        userId: 'user-a',
        modelId: 'qwen3.7-plus',
        thinkingEffort: 'balanced',
        activeRunLockToken: expect.any(String),
        selectedSkillNames: [],
      }),
    )
  })

  it('passes manually selected global Skill names into the asynchronous Run executor', async () => {
    const { service, models, threads, runs, runService } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow())
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      contextWindowTokens: 128_000,
    })
    ;(runs.admit as jest.Mock).mockResolvedValue({
      id: 'run-skill',
      threadId: 'thread-1',
      userId: 'user-a',
      status: 'RUNNING',
      limitReason: null,
      input: '清洗数据',
      errorCode: null,
      errorMessage: null,
      promptProfileVersion: null,
      promptHash: null,
      promptManifest: null,
      modelCallCount: 0,
      toolCallCount: 0,
      webFetchCount: 0,
      shellCallCount: 0,
      sandboxId: null,
      activeSkillManifest: null,
      fileManifest: null,
      sandboxUsage: null,
      sandboxStartedAt: null,
      sandboxDestroyedAt: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageUnknown: false,
      estimatedCostCny: null,
      lastSequence: -1,
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      updatedAt: new Date('2026-07-20T00:00:00.000Z'),
      startedAt: null,
      completedAt: null,
    })
    await service.createRun(user, 'thread-1', '清洗数据', [{ name: 'mock-data-cleaner' }], 'deep')

    expect(runService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingEffort: 'deep',
        selectedSkillNames: ['mock-data-cleaner'],
      }),
    )
  })

  it('maps an atomic user-limit rejection and releases the Thread lock', async () => {
    const { service, threads, runs, models, activeRunLock, runService } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow({ id: 'thread-b' }))
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'qwen3.7-plus',
      provider: 'qwen',
      contextWindowTokens: 128_000,
    })
    ;(runs.admit as jest.Mock).mockRejectedValue(new AgentUserConcurrencyLimitError(2))

    await expect(service.createRun(user, 'thread-b', '并行任务')).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(activeRunLock.userLimit).toHaveBeenCalledWith(2)
    expect(activeRunLock.release).toHaveBeenCalledWith('thread-b', expect.any(String))
    expect(runService.execute).not.toHaveBeenCalled()
  })

  it('refuses to delete a thread with an active run', async () => {
    const { service, threads, runs } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow())
    ;(runs.findActiveForThread as jest.Mock).mockResolvedValue({ id: 'run-1' })
    await expect(service.deleteThread(user, 'thread-1')).rejects.toBeInstanceOf(ConflictException)
    expect(threads.deleteForOwner).not.toHaveBeenCalled()
  })

  it('rejects blank rename titles after trim', async () => {
    const { service, threads } = setup()
    await expect(service.renameThread(user, 'thread-1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(threads.renameForOwner).not.toHaveBeenCalled()
  })

  it('renames an owned thread and returns the updated summary', async () => {
    const { service, threads } = setup()
    ;(threads.renameForOwner as jest.Mock).mockResolvedValue(true)
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(
      threadRow({ title: '整理会议纪要' }),
    )
    await expect(service.renameThread(user, 'thread-1', '  整理会议纪要  ')).resolves.toEqual(
      expect.objectContaining({ id: 'thread-1', title: '整理会议纪要' }),
    )
    expect(threads.renameForOwner).toHaveBeenCalledWith('thread-1', 'user-a', '整理会议纪要')
    expect(threads.renameForOwner).toHaveBeenCalledTimes(1)
  })

  it('createRun always uses the thread-bound modelId rather than a client-supplied model', async () => {
    const { service, threads, runs, models, runService } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(
      threadRow({ modelId: 'glm-5.2', provider: 'glm', title: '已绑定' }),
    )
    ;(models.resolve as jest.Mock).mockReturnValue({
      id: 'glm-5.2',
      provider: 'glm',
      upstreamModelId: 'glm-5.2',
      displayName: 'GLM',
    })
    ;(runs.admit as jest.Mock).mockResolvedValue({
      id: 'run-1',
      threadId: 'thread-1',
      status: 'RUNNING',
      limitReason: null,
      usageUnknown: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCny: null,
      modelCallCount: 0,
      toolCallCount: 0,
      webFetchCount: 0,
      lastSequence: -1,
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      startedAt: null,
      completedAt: null,
    })
    await service.createRun(user, 'thread-1', '继续')
    expect(runService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'glm-5.2', provider: 'glm' }),
    )
    expect(runs.admit).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', userId: 'user-a' }),
    )
  })

  it('deletes an owned thread when no run is active', async () => {
    const { service, threads, runs, executionSessions } = setup()
    ;(threads.findSummaryForOwner as jest.Mock).mockResolvedValue(threadRow())
    ;(runs.findActiveForThread as jest.Mock).mockResolvedValue(null)
    ;(threads.deleteForOwner as jest.Mock).mockResolvedValue(true)
    await expect(service.deleteThread(user, 'thread-1')).resolves.toBeUndefined()
    expect(executionSessions.destroyThread).toHaveBeenCalledWith('thread-1')
    expect(threads.deleteForOwner).toHaveBeenCalledWith('thread-1', 'user-a')
  })

  it('cancels a run only when owned by the user', async () => {
    const { service, runs, runService } = setup()
    ;(runs.findForOwner as jest.Mock).mockResolvedValue(null)
    await expect(service.cancelRun(user, 'run-x')).rejects.toBeInstanceOf(NotFoundException)
    expect(runService.cancel).not.toHaveBeenCalled()
  })
})
