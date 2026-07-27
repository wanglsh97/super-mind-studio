import { randomUUID } from 'node:crypto'

import type { AgentExecutionError, AgentRunTerminalStatus } from '@supermind/sdk'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Message, Usage as PiUsage } from '@earendil-works/pi-ai'
import type { AgentEvent } from '@earendil-works/pi-agent-core'

import type { AgentRunStatus } from '../generated/prisma/client'
import { MODEL_INVOCATION_PORT } from '../chat/model-invocation.port'
import type { ModelInvocationPort } from '../chat/model-invocation.port'
import { PricingService } from '../billing/pricing.service'
import { RequestLifecycleService } from '../request-lifecycle/request-lifecycle.service'
import { createAgentModelInvocationPort } from './agent-model-invocation'
import { AgentActiveRunLock } from './agent-active-run.lock'
import { AgentContextPreparer } from './context/agent-context-preparer'
import { AgentContextSummaryRepository } from './context/agent-context-summary.repository'
import {
  AgentContextCompressionFailedError,
  AgentContextSummaryService,
} from './context/agent-context-summary.service'
import type { AgentContextSummaryV1 } from './context/agent-context-summary.schema'
import {
  assembleAgentHistory,
  persistedMessageToAdapter,
  selectMessagesForForcedSummary,
} from './context/agent-history-context'
import { AgentMessageRepository } from './agent-message.repository'
import { AgentRunEventBus } from './agent-run-event-bus'
import { AgentRunProjector } from './agent-run.projector'
import { AgentRunRepository } from './agent-run.repository'
import { AgentPromptComposer } from './prompt/agent-prompt.composer'
import { AgentExecutionSessionService } from './sandbox/agent-execution-session.service'
import type { ActivatedSkill } from './skills/executable-skill.service'
import { renderActiveSkillPrompt } from './skills/active-skill-prompt'
import { AgentToolRegistry } from './tools/agent-tool.registry'
import { loadPiAgentCore } from './pi-runtime'
import { createPiModel, createPiStreamFn } from './pi-stream-bridge'
import { toPiAgentTool } from './pi-tool.adapter'

export interface ExecuteAgentRunInput {
  runId: string
  threadId: string
  userId: string
  modelId: string
  provider: string
  contextWindowTokens: number
  input: string
  selectedSkillNames: readonly string[]
  /** createRun 持有的用户级 Redis 锁 token，终态 finally 中释放。 */
  activeRunLockToken: string
}

const TERMINAL_STATUS_MAP: Record<AgentRunTerminalStatus, AgentRunStatus> = {
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
  limit_reached: 'LIMIT_REACHED',
  interrupted: 'INTERRUPTED',
}

interface ActiveRun {
  controller: AbortController
}

/**
 * Agent run 编排服务。
 *
 * 在 NestJS 进程内构造 Pi harness，通过 StreamFn bridge 复用 ModelInvocationPort，订阅 Pi
 * 事件并交由 AgentRunProjector 投影为带 sequence 的 wire 事件；事件实时投影到事件总线并持久化，
 * run 终结时落库消息快照、工具调用与计数。浏览器断线不取消 run；取消经 AbortController 传播。
 */
@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name)
  private readonly activeRuns = new Map<string, ActiveRun>()

  constructor(
    @Inject(AgentRunRepository) private readonly runs: AgentRunRepository,
    @Inject(AgentMessageRepository) private readonly messages: AgentMessageRepository,
    @Inject(AgentToolRegistry) private readonly tools: AgentToolRegistry,
    @Inject(MODEL_INVOCATION_PORT) private readonly modelInvocation: ModelInvocationPort,
    @Inject(RequestLifecycleService) private readonly lifecycle: RequestLifecycleService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(AgentRunEventBus) private readonly bus: AgentRunEventBus,
    @Inject(AgentActiveRunLock) private readonly activeRunLock: AgentActiveRunLock,
    @Inject(AgentPromptComposer) private readonly promptComposer: AgentPromptComposer,
    @Inject(AgentContextPreparer) private readonly contextPreparer: AgentContextPreparer,
    @Inject(AgentContextSummaryRepository)
    private readonly contextSummaries: AgentContextSummaryRepository,
    @Inject(AgentContextSummaryService)
    private readonly contextSummaryService: AgentContextSummaryService,
    @Inject(AgentExecutionSessionService)
    private readonly executionSessions: AgentExecutionSessionService,
  ) {}

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId)
  }

  cancel(runId: string): void {
    this.activeRuns.get(runId)?.controller.abort()
  }

  /**
   * 执行一次 Agent run 至终态并持久化。调用方负责已创建 AgentRun(RUNNING) 与 user 消息。
   * 该方法在进程内异步执行，浏览器断线不影响其完成。
   */
  async execute(input: ExecuteAgentRunInput): Promise<void> {
    const controller = new AbortController()
    this.activeRuns.set(input.runId, { controller })
    this.bus.open(input.runId)

    const projector = new AgentRunProjector(input.runId, () => randomUUID())
    const persistAndPublish = async (
      events: ReturnType<AgentRunProjector['ingest']>,
    ): Promise<void> => {
      // 必须先落库再广播：确保任何已投影到 SSE 的事件都已在 PostgreSQL 中可补读，
      // 避免订阅者在“已广播未入库”窗口做游标补读时丢失事件、产生 sequence 间隙。
      if (events.length > 0) await this.runs.appendEvents(input.runId, events)
      for (const event of events) this.bus.publish(input.runId, event)
    }

    try {
      await this.runs.markStarted(input.runId)
      await persistAndPublish(projector.start())

      const manuallyActivated: ActivatedSkill[] = []
      for (const skillName of [...new Set(input.selectedSkillNames)]) {
        await persistAndPublish(
          projector.skillActivation({
            status: 'running',
            source: 'manual',
            skillId: skillName,
            skillName,
          }),
        )
        let activated: Awaited<ReturnType<AgentExecutionSessionService['activateSkill']>>
        try {
          activated = await this.executionSessions.activateSkill(
            input.runId,
            input.userId,
            skillName,
            controller.signal,
          )
        } catch (error) {
          await persistAndPublish(
            projector.skillActivation({
              status: controller.signal.aborted ? 'cancelled' : 'failed',
              source: 'manual',
              skillId: skillName,
              skillName,
              error: normalizeExecutionError(error),
            }),
          )
          throw error
        }
        manuallyActivated.push(activated.skill)
        await persistAndPublish(
          projector.skillActivation({
            status: 'succeeded',
            source: 'manual',
            skillId: activated.skill.manifest.skillId,
            skillName: activated.skill.manifest.name,
            packageSha256: activated.skill.manifest.packageSha256,
          }),
        )
      }

      const boundPort = createAgentModelInvocationPort(
        this.modelInvocation,
        this.lifecycle,
        this.pricing,
        { userId: input.userId, agentRunId: input.runId },
      )

      const { Agent } = await loadPiAgentCore()
      const [persistedHistory, initialSummary] = await Promise.all([
        this.messages.listForThread(input.threadId),
        this.contextSummaries.findForThread(input.threadId),
      ])
      let activeSummary = initialSummary
      const composedPrompt = await this.promptComposer.compose({
        userId: input.userId,
        threadId: input.threadId,
        modelId: input.modelId,
        provider: input.provider,
        contextWindowTokens: input.contextWindowTokens,
        summaryId: activeSummary?.id ?? null,
      })
      await this.runs.savePromptAudit(input.runId, composedPrompt.manifest)
      let contextLimitError: AgentContextLimitError | undefined
      const agent = new Agent({
        initialState: {
          systemPrompt: appendManualSkillInstructions(
            composedPrompt.systemPrompt,
            manuallyActivated.map((skill) => ({
              name: skill.manifest.name,
              packageSha256: skill.manifest.packageSha256,
              skillMarkdown: skill.skillMarkdown,
            })),
          ),
          model: createPiModel(input.modelId, input.provider, input.contextWindowTokens),
          tools: this.tools
            .list()
            .map((tool) =>
              toPiAgentTool(tool, this.tools, { runId: input.runId, userId: input.userId }),
            ),
        },
        streamFn: createPiStreamFn({
          port: boundPort,
          createRequestId: () => randomUUID(),
          prepareMessages: async (currentMessages, tools) => {
            try {
              const assembled = assembleAgentHistory({
                persistedMessages: persistedHistory,
                currentRunId: input.runId,
                currentMessages,
                ...(activeSummary === null
                  ? {}
                  : {
                      summary: {
                        content: activeSummary.content as unknown as AgentContextSummaryV1,
                        coveredThroughSequence: activeSummary.coveredThroughSequence,
                      },
                    }),
              })
              const prepared = this.contextPreparer.prepare({
                contextWindowTokens: input.contextWindowTokens,
                messages: assembled,
                tools,
              })
              await persistAndPublish(
                projector.contextBudget({
                  usedTokens: prepared.budget.usedTokens,
                  usableTokens: prepared.budget.usableTokens,
                  contextWindowTokens: prepared.budget.contextWindowTokens,
                  estimated: prepared.budget.estimated,
                  level: prepared.budget.level,
                  ...(activeSummary === null ? {} : { summaryId: activeSummary.id }),
                }),
              )
              if (prepared.budget.level !== 'forced') {
                if (
                  prepared.compressionNotes.length > 0 &&
                  prepared.appliedCompressionLevel !== 'none'
                ) {
                  await persistAndPublish(
                    projector.contextCompressed({
                      level: prepared.appliedCompressionLevel,
                      notes: prepared.compressionNotes,
                      ...(activeSummary === null ? {} : { summaryId: activeSummary.id }),
                    }),
                  )
                }
                return prepared.messages
              }

              const candidates = selectMessagesForForcedSummary(
                persistedHistory,
                input.runId,
                activeSummary?.coveredThroughSequence ?? -1,
              )
              if (candidates.length === 0) {
                throw new AgentContextWindowExceededError()
              }
              let generated
              try {
                generated = await this.contextSummaryService.generate({
                  port: boundPort,
                  modelId: input.modelId,
                  messages: candidates.flatMap((message) => persistedMessageToAdapter(message)),
                  ...(activeSummary === null
                    ? {}
                    : {
                        previousSummary: activeSummary.content as unknown as AgentContextSummaryV1,
                      }),
                  signal: controller.signal,
                })
              } catch (error) {
                if (error instanceof AgentContextCompressionFailedError) {
                  throw new AgentContextLimitError(error.code, error.message)
                }
                throw error
              }
              const boundary = candidates.at(-1)?.sequence
              if (boundary === undefined) throw new AgentContextWindowExceededError()
              projector.addUsage(generated.usage)
              activeSummary = await this.contextSummaries.saveValid({
                threadId: input.threadId,
                coveredThroughSequence: boundary,
                schemaVersion: generated.schemaVersion,
                promptHash: generated.promptHash,
                modelId: input.modelId,
                content: generated.content,
                inputTokens: generated.usage.inputTokens,
                outputTokens: generated.usage.outputTokens,
                totalTokens: generated.usage.totalTokens,
              })
              await persistAndPublish(
                projector.contextCompressed({
                  level: 'forced',
                  notes: ['structured-summary-updated', 'historical-reasoning-omitted'],
                  summaryId: activeSummary.id,
                  revision: activeSummary.revision,
                  coveredThroughSequence: boundary,
                }),
              )
              const afterSummary = assembleAgentHistory({
                persistedMessages: persistedHistory,
                currentRunId: input.runId,
                currentMessages,
                summary: {
                  content: generated.content,
                  coveredThroughSequence: boundary,
                },
              })
              const recounted = this.contextPreparer.prepare({
                contextWindowTokens: input.contextWindowTokens,
                messages: afterSummary,
                tools,
              })
              if (recounted.budget.level === 'forced') throw new AgentContextWindowExceededError()
              await persistAndPublish(
                projector.contextBudget({
                  usedTokens: recounted.budget.usedTokens,
                  usableTokens: recounted.budget.usableTokens,
                  contextWindowTokens: recounted.budget.contextWindowTokens,
                  estimated: recounted.budget.estimated,
                  level: recounted.budget.level,
                  summaryId: activeSummary.id,
                }),
              )
              return recounted.messages
            } catch (error) {
              if (error instanceof AgentContextLimitError) contextLimitError = error
              throw error
            }
          },
        }),
        convertToLlm: (messages) => messages as Message[],
      })

      agent.subscribe(async (event: AgentEvent, signal) => {
        void signal
        if (event.type === 'turn_end') {
          const message = event.message
          if (message.role === 'assistant') {
            projector.addUsage(fromPiUsage(message.usage))
            if (message.stopReason === 'error') {
              projector.recordFailure({
                code: 'AGENT_MODEL_ERROR',
                message: message.errorMessage ?? '模型调用失败',
                retryable: true,
              })
            }
          }
        }
        await persistAndPublish(projector.ingest(event))
      })

      // 把外部取消传播到 Pi 运行。
      controller.signal.addEventListener('abort', () => agent.abort(), { once: true })

      try {
        await agent.prompt(input.input)
      } catch (error) {
        this.logger.warn({ error, runId: input.runId }, 'Agent prompt rejected')
      }

      const status = contextLimitError
        ? 'limit_reached'
        : this.determineTerminal(controller.signal.aborted, agent.state.errorMessage)
      const error = contextLimitError
        ? { code: contextLimitError.code, message: contextLimitError.message, retryable: false }
        : status === 'failed'
          ? {
              code: 'AGENT_RUN_FAILED',
              message: agent.state.errorMessage ?? '模型调用失败',
              retryable: true,
            }
          : undefined
      await this.finalize(
        input,
        projector,
        status,
        error,
        contextLimitError ? 'context_window' : undefined,
      )
    } catch (error) {
      this.logger.error({ error, runId: input.runId }, 'Agent run crashed')
      await this.finalize(input, projector, 'failed', {
        code: 'AGENT_RUN_CRASHED',
        message: error instanceof Error ? error.message : 'Agent run 失败',
        retryable: true,
      }).catch((finalizeError) => {
        this.logger.error({ error: finalizeError, runId: input.runId }, 'Agent finalize failed')
      })
    } finally {
      await this.executionSessions.destroyRun(input.runId).catch((error) => {
        this.logger.error({ error, runId: input.runId }, 'Agent sandbox cleanup failed')
      })
      this.activeRuns.delete(input.runId)
      this.bus.close(input.runId)
      await this.activeRunLock.release(input.userId, input.activeRunLockToken)
    }
  }

  private determineTerminal(
    aborted: boolean,
    errorMessage: string | undefined,
  ): AgentRunTerminalStatus {
    if (aborted) return 'cancelled'
    if (errorMessage) return 'failed'
    return 'succeeded'
  }

  private async finalize(
    input: ExecuteAgentRunInput,
    projector: AgentRunProjector,
    status: AgentRunTerminalStatus,
    error: { code: string; message: string; retryable: boolean } | undefined,
    limitReason?: 'context_window',
  ): Promise<void> {
    // 先计算终态事件（会关闭仍打开的消息并定稿快照）。
    const terminalEvents = projector.finalize(status, {
      ...(error === undefined ? {} : { error }),
      ...(limitReason === undefined ? {} : { limitReason }),
    })

    // 在向客户端发出终态事件前，先持久化消息快照、工具调用与 run 计数，
    // 使“收到 run-terminal”即代表刷新可恢复完整快照。
    const snapshot = projector.messagesSnapshot()
    await this.messages.appendMessages(
      input.threadId,
      input.runId,
      snapshot.map((message) => ({ role: message.role, parts: message.parts })),
    )
    await this.runs.saveToolCalls(input.runId, projector.toolCallRecords())

    const usage = projector.usageAggregate()
    await this.runs.finalize(input.runId, {
      status: TERMINAL_STATUS_MAP[status],
      lastSequence: projector.lastSequence,
      modelCallCount: usage.modelCalls,
      toolCallCount: usage.toolCalls,
      webFetchCount: usage.webFetchCalls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      usageUnknown: usage.usageUnknown,
      ...(limitReason === undefined ? {} : { limitReason: 'CONTEXT_WINDOW' }),
      ...(error === undefined ? {} : { errorCode: error.code, errorMessage: error.message }),
    })

    // 快照落库后再持久化并广播终态事件（usage + run-terminal）。
    if (terminalEvents.length > 0) await this.runs.appendEvents(input.runId, terminalEvents)
    for (const event of terminalEvents) this.bus.publish(input.runId, event)
  }
}

class AgentContextLimitError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AgentContextLimitError'
  }
}

class AgentContextWindowExceededError extends AgentContextLimitError {
  constructor() {
    super('AGENT_CONTEXT_WINDOW_EXCEEDED', '当前输入与必须保留的上下文超过模型可用窗口')
    this.name = 'AgentContextWindowExceededError'
  }
}

function appendManualSkillInstructions(
  systemPrompt: string,
  skills: readonly { name: string; packageSha256: string; skillMarkdown: string }[],
): string {
  if (skills.length === 0) return systemPrompt
  const instructions = skills.map(renderActiveSkillPrompt).join('\n\n')
  return `${systemPrompt}\n\n# Manually activated Skills\n\n${instructions}`
}

function normalizeExecutionError(error: unknown): AgentExecutionError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return {
      code: error.code as AgentExecutionError['code'],
      message: error.message,
      retryable: 'retryable' in error && error.retryable === true,
    }
  }
  return {
    code: 'SANDBOX_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'Skill 激活失败',
    retryable: false,
  }
}

function fromPiUsage(usage: PiUsage): {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  usageUnknown: boolean
} {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    usageUnknown: false,
  }
}
