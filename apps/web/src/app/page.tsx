'use client'

import { createAIGatewayClient, parseAgentOutputFileReference } from '@supermind/sdk'
import type {
  AgentContextBudgetState,
  AgentContextSummary,
  AgentMcpServerStatus,
  AgentSandboxStatus,
  AgentSkillCandidate,
  AgentStreamEvent,
  AgentThreadSandbox,
  TextModelAlias,
  TextModelId,
} from '@supermind/sdk'
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  makeAssistantToolUI,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
} from '@assistant-ui/react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { useAgentActiveThreadId, useAgentWorkspace } from '../components/agent-workspace-provider'
import { AgentSkillSlashPicker } from '../components/agent-skill-slash-picker'
import {
  AgentActiveRunHint,
  AgentComposerAction,
  AgentComposerActions,
  AgentComposerDock,
  AgentComposerFooter,
  AgentComposerInput,
  AgentComposerRoot,
  AgentComposerSubmitGroup,
  AgentConsolePanel,
  AgentEmptyState,
  AgentInterruptedBanner,
  AgentPageShell,
  AgentPrivacyNote,
  AgentReasoning,
  AgentRunMetadata,
  AgentScrollToBottom,
  AgentSendButton,
  AgentSendButtonDisabled,
  AgentThreadRoot,
  AgentThreadViewport,
  AgentToolCall,
  AgentToolResult,
  AssistantMessage,
  ModelSelect,
  NewThreadButton,
  UserMessage,
} from '../components/chat-thread-ui'
import { ProtectedUserPage } from '../components/protected-user-page'
import { useAuthenticationFailure } from '../components/use-authentication-failure'
import { cn } from '../lib/cn'
import { AssistantMarkdown } from './chat/assistant-markdown'
import {
  agentMessagesToThreadMessages,
  createAgentRunAdapter,
  type AgentRunMetadata as AgentRunMetadataType,
} from './agent/agent-run-adapter'
import { shouldStartNewThreadOnModelChange } from './agent/agent-model-policy'
import {
  foldEventsFromCursor,
  isResumableActiveRun,
  mergeThreadMessagesWithRunView,
} from './agent/agent-run-resume'
import { initialAgentRunViewState } from './agent/agent-run-reducer'
import {
  AGENT_TOOL_ACTIVITY_LABELS,
  resolveAgentToolActivityState,
  type AgentToolActivityState,
} from './agent/agent-tool-activity'
import { parseNamespacedMcpToolName, summarizeAgentMcpStatuses } from './agent/agent-mcp-status'

const client = createAIGatewayClient()

interface ModelOption {
  value: TextModelId
  label: string
  provider: TextModelAlias
}

export default function AgentPage() {
  return (
    <ProtectedUserPage>
      <Suspense fallback={<AgentPageShell aria-busy="true" />}>
        <AgentConsole />
      </Suspense>
    </ProtectedUserPage>
  )
}

function AgentConsole() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const {
    models,
    selectedModel,
    setSelectedModel,
    openThread,
    prependThread,
    startNewThread,
    refreshThreads,
    userActiveRun,
    setUserActiveRun,
  } = useAgentWorkspace()
  const activeThreadId = useAgentActiveThreadId()
  const [contextBudget, setContextBudget] = useState<AgentContextBudgetState | null>(null)
  const [contextSummary, setContextSummary] = useState<AgentContextSummary | null>(null)
  const [compressionEvents, setCompressionEvents] = useState<
    Extract<AgentStreamEvent, { type: 'context-compressed' }>[]
  >([])
  const [skillCandidates, setSkillCandidates] = useState<AgentSkillCandidate[]>([])
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([])
  const [skillLoadState, setSkillLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [mcpServers, setMcpServers] = useState<AgentMcpServerStatus[]>([])
  const [mcpLoadState, setMcpLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [sandboxTelemetry, setSandboxTelemetry] = useState<SandboxTelemetry>({ status: 'idle' })

  const skipHydrationRef = useRef(false)
  const contextRef = useRef({
    threadId: activeThreadId as string | null,
    model: selectedModel,
    selectedSkillNames: [] as readonly string[],
    onThreadCreated: (() => undefined) as (thread: Parameters<typeof prependThread>[0]) => void,
    onRunCreated: (() => undefined) as (run: { id: string; threadId: string }) => void,
    onRunFinished: () => undefined,
    onContextBudget: (() => undefined) as (budget: AgentContextBudgetState) => void,
    onContextCompressed: (() => undefined) as (
      event: Extract<AgentStreamEvent, { type: 'context-compressed' }>,
    ) => void,
    onSandboxStatus: (() => undefined) as (status: AgentSandboxStatus, sandboxId?: string) => void,
  })

  contextRef.current.threadId = activeThreadId
  contextRef.current.model = selectedModel
  contextRef.current.selectedSkillNames = selectedSkillNames
  contextRef.current.onThreadCreated = (thread) => {
    skipHydrationRef.current = true
    setContextBudget(null)
    setContextSummary(null)
    setCompressionEvents([])
    prependThread(thread)
    openThread(thread.id)
  }
  contextRef.current.onRunCreated = (run) => {
    setSandboxTelemetry({ status: 'creating' })
    setUserActiveRun({
      id: run.id,
      threadId: run.threadId,
      status: 'running',
      limitReason: null,
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        usageUnknown: true,
        estimatedCostCny: null,
        modelCalls: 0,
        toolCalls: 0,
        webFetchCalls: 0,
      },
      lastSequence: -1,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    })
  }
  contextRef.current.onRunFinished = () => {
    setSandboxTelemetry((current) =>
      current.status === 'failed'
        ? current
        : current.status === 'ready'
          ? current.sandboxId
            ? { status: 'standby', sandboxId: current.sandboxId }
            : { status: 'idle' }
          : { status: 'idle' },
    )
    setUserActiveRun(null)
    void refreshThreads().catch(() => undefined)
  }
  contextRef.current.onContextBudget = setContextBudget
  contextRef.current.onContextCompressed = (event) => {
    setCompressionEvents((current) => [...current, event])
    if (event.summaryId && contextRef.current.threadId) {
      void client.agent.threads
        .get(contextRef.current.threadId)
        .then((thread) => {
          setContextSummary(thread.contextSummary)
        })
        .catch(() => undefined)
    }
  }
  contextRef.current.onSandboxStatus = (status, sandboxId) => {
    setSandboxTelemetry({
      status,
      ...(sandboxId === undefined ? {} : { sandboxId }),
    })
  }

  const loadSkillCandidates = () => {
    setSkillLoadState('loading')
    return client.agent.skills
      .candidates()
      .then((items) => {
        setSkillCandidates(items)
        setSelectedSkillNames((current) =>
          current.filter((name) => items.some((item) => item.name === name)),
        )
        setSkillLoadState('ready')
      })
      .catch((error) => {
        handleAuthenticationFailure(error)
        setSkillLoadState('failed')
      })
  }

  useEffect(() => {
    void loadSkillCandidates()
    void client.agent.mcp
      .servers()
      .then((servers) => {
        setMcpServers(servers)
        setMcpLoadState('ready')
      })
      .catch((error) => {
        handleAuthenticationFailure(error)
        setMcpLoadState('failed')
      })
  }, [])

  const modelOptions = useMemo<ModelOption[]>(
    () =>
      models.flatMap((model) =>
        isTextModelAlias(model.alias)
          ? [{ value: model.id as TextModelId, label: model.displayName, provider: model.alias }]
          : [],
      ),
    [models],
  )

  const handleModelChange = (nextModel: TextModelId) => {
    const current = (selectedModel as TextModelId) || modelOptions[0]?.value || 'qwen3.7-plus'
    const leaveThread = shouldStartNewThreadOnModelChange(activeThreadId, current, nextModel)
    setSelectedModel(nextModel)
    if (leaveThread) {
      skipHydrationRef.current = false
      startNewThread()
    }
  }

  const adapter = useMemo(
    () =>
      createAgentRunAdapter(
        client,
        () => contextRef.current,
        (error) => {
          handleAuthenticationFailure(error)
        },
      ),
    [handleAuthenticationFailure],
  )

  const runtime = useLocalRuntime(adapter)
  const modelDisabled = modelOptions.length === 0
  const submitBlocked = modelDisabled || userActiveRun !== null

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadHydrator
        skipHydrationRef={skipHydrationRef}
        onContextBudget={setContextBudget}
        onContextSummary={setContextSummary}
        onCompressionEvent={(event) => setCompressionEvents((current) => [...current, event])}
        onResetCompressionEvents={() => setCompressionEvents([])}
        onSandboxStatus={(status, sandboxId) =>
          setSandboxTelemetry({
            status,
            ...(sandboxId === undefined ? {} : { sandboxId }),
          })
        }
        onSandboxSnapshot={(sandbox) => setSandboxTelemetry(toSandboxTelemetry(sandbox))}
      />
      <WebFetchToolUI />
      <ShellToolUI />
      <ReadFileToolUI />
      <WriteFileToolUI />
      <ExportFileToolUI />
      <AgentPageShell>
        <AgentConsolePanel label="智能体">
          <SandboxStatusModule telemetry={sandboxTelemetry} />
          <AgentThreadRoot>
            <AgentThreadViewport>
              <ThreadPrimitive.Empty>
                <AgentEmptyState
                  kicker="AGENT THREAD · EMPTY"
                  title="交给 Agent 一个可执行的任务"
                />
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages>
                {({ message }) =>
                  message.role === 'user' ? (
                    <UserMessage />
                  ) : (
                    <AssistantMessage
                      label="SUPER MIND · AGENT"
                      metadata={<AgentMessageMetadata />}
                      renderPart={(part) => {
                        if (part.type === 'tool-call') {
                          if (part.toolUI) return part.toolUI
                          const toolPart = part as typeof part & {
                            toolName?: unknown
                            args?: unknown
                            result?: unknown
                            isError?: unknown
                          }
                          if (typeof toolPart.toolName !== 'string') return null
                          const parsed = parseNamespacedMcpToolName(toolPart.toolName)
                          if (parsed) {
                            const result = isSandboxToolResult(toolPart.result)
                              ? toolPart.result
                              : undefined
                            return (
                              <McpToolActivityCard
                                serverId={parsed.serverId}
                                remoteToolName={parsed.remoteToolName}
                                args={isRecord(toolPart.args) ? toolPart.args : {}}
                                result={result}
                                running={result === undefined}
                                isError={toolPart.isError === true}
                              />
                            )
                          }
                          return null
                        }
                        if (part.type === 'text')
                          return <AssistantMarkdown>{part.text ?? ''}</AssistantMarkdown>
                        if (part.type === 'reasoning') {
                          return <AgentReasoning text={part.text ?? ''} />
                        }
                        return null
                      }}
                    />
                  )
                }
              </ThreadPrimitive.Messages>
              <AgentContextTimeline events={compressionEvents} summary={contextSummary} />
            </AgentThreadViewport>
            <AgentScrollToBottom />
            <AgentComposerDock>
              <AgentMcpStatusPanel statuses={mcpServers} loadState={mcpLoadState} />
              <AgentContextBudgetBadge budget={contextBudget} summary={contextSummary} />
              {userActiveRun && userActiveRun.threadId !== activeThreadId ? (
                <AgentActiveRunHint message="另一会话正在运行，请等待结束后再提交" />
              ) : null}
              <AgentComposerRoot>
                <AgentSkillSlashPicker
                  candidates={skillCandidates}
                  selectedNames={selectedSkillNames}
                  loadState={skillLoadState}
                  disabled={userActiveRun !== null}
                  onToggle={(name) =>
                    setSelectedSkillNames((current) =>
                      current.includes(name)
                        ? current.filter((item) => item !== name)
                        : [...current, name],
                    )
                  }
                  onRetry={() => void loadSkillCandidates()}
                />
                <AgentComposerInput
                  placeholder={
                    submitBlocked && !modelDisabled
                      ? '已有进行中的 Agent 运行，请等待结束后再提交…'
                      : '描述你想让 Agent 完成的任务…'
                  }
                  disabled={submitBlocked}
                  maxLength={8000}
                />
                <AgentComposerFooter>
                  <AgentComposerActions>
                    <NewThreadButton onNewThread={startNewThread} />
                    <AgentComposerAction href="/chat/compare">模型对比</AgentComposerAction>
                  </AgentComposerActions>
                  <AgentComposerSubmitGroup>
                    <ModelSelect
                      value={
                        (selectedModel as TextModelId) || modelOptions[0]?.value || 'qwen3.7-plus'
                      }
                      options={modelOptions}
                      disabled={modelDisabled}
                      boundHint={activeThreadId !== null}
                      onChange={handleModelChange}
                    />
                    <AgentStopButton />
                    <AuiIf condition={({ thread }) => !thread.isRunning && !submitBlocked}>
                      <AgentSendButton />
                    </AuiIf>
                    <AuiIf condition={({ thread }) => !thread.isRunning && submitBlocked}>
                      <AgentSendButtonDisabled />
                    </AuiIf>
                  </AgentComposerSubmitGroup>
                </AgentComposerFooter>
              </AgentComposerRoot>
              <AgentPrivacyNote />
            </AgentComposerDock>
          </AgentThreadRoot>
        </AgentConsolePanel>
      </AgentPageShell>
    </AssistantRuntimeProvider>
  )
}

type SandboxTelemetry =
  | { status: 'idle' }
  | { status: 'standby'; sandboxId: string }
  | { status: AgentSandboxStatus; sandboxId?: string }

const SANDBOX_STATUS_COPY: Record<
  SandboxTelemetry['status'],
  { label: string; note: string; tone: string; dot: string }
> = {
  idle: {
    label: '未启动',
    note: '随任务创建',
    tone: 'text-ink-muted',
    dot: 'bg-ink-subtle/45',
  },
  standby: {
    label: '空闲可用',
    note: '等待下一轮任务',
    tone: 'text-success',
    dot: 'bg-success',
  },
  creating: {
    label: '启动中',
    note: '正在准备容器',
    tone: 'text-brand',
    dot: 'bg-brand animate-status-breathe',
  },
  ready: {
    label: '容器就绪',
    note: '隔离环境运行中',
    tone: 'text-success',
    dot: 'bg-success animate-status-breathe',
  },
  failed: {
    label: '启动失败',
    note: '本次任务不可执行',
    tone: 'text-danger',
    dot: 'bg-danger',
  },
}

function SandboxStatusModule({ telemetry }: { telemetry: SandboxTelemetry }) {
  const copy = SANDBOX_STATUS_COPY[telemetry.status]
  const sandboxId = 'sandboxId' in telemetry ? telemetry.sandboxId : undefined
  const shortId = sandboxId
    ? sandboxId.length > 16
      ? `${sandboxId.slice(0, 7)}…${sandboxId.slice(-5)}`
      : sandboxId
    : null

  return (
    <aside
      aria-live="polite"
      aria-label={`沙箱容器状态：${copy.label}`}
      className="liquid-glass-soft fixed top-4 right-4 z-30 flex min-w-44 items-center gap-3 rounded-[1rem] border-line/75 px-3 py-2.5 shadow-[0_12px_32px_rgb(44_62_92/0.10)]"
      title={shortId ? `Sandbox ID: ${sandboxId}` : copy.note}
    >
      <span
        aria-hidden="true"
        className="relative grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-inset/75 text-ink-muted"
      >
        <svg viewBox="0 0 24 24" className="size-[1.15rem] fill-none stroke-current stroke-[1.6]">
          <path d="m4.5 7.5 7.5-4 7.5 4-7.5 4-7.5-4Z" strokeLinejoin="round" />
          <path d="M4.5 7.5v8.7l7.5 4.3 7.5-4.3V7.5M12 11.5v9" strokeLinejoin="round" />
        </svg>
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface-card',
            copy.dot,
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[0.52rem] font-bold tracking-[0.16em] text-ink-subtle">
          SANDBOX
        </span>
        <span className={cn('mt-0.5 block text-xs font-bold', copy.tone)}>{copy.label}</span>
        <span className="mt-0.5 block max-w-28 truncate font-mono text-[0.54rem] text-ink-subtle">
          {shortId ?? copy.note}
        </span>
      </span>
    </aside>
  )
}

function toSandboxTelemetry(sandbox: AgentThreadSandbox | null): SandboxTelemetry {
  if (!sandbox) return { status: 'idle' }
  if (sandbox.status === 'idle' || sandbox.status === 'ready') {
    return { status: 'standby', sandboxId: sandbox.id }
  }
  return { status: sandbox.status, sandboxId: sandbox.id }
}

function ThreadHydrator({
  skipHydrationRef,
  onContextBudget,
  onContextSummary,
  onCompressionEvent,
  onResetCompressionEvents,
  onSandboxStatus,
  onSandboxSnapshot,
}: {
  skipHydrationRef: { current: boolean }
  onContextBudget: (budget: AgentContextBudgetState | null) => void
  onContextSummary: (summary: AgentContextSummary | null) => void
  onCompressionEvent: (event: Extract<AgentStreamEvent, { type: 'context-compressed' }>) => void
  onResetCompressionEvents: () => void
  onSandboxStatus: (status: AgentSandboxStatus, sandboxId?: string) => void
  onSandboxSnapshot: (sandbox: AgentThreadSandbox | null) => void
}) {
  const api = useAui()
  const activeThreadId = useAgentActiveThreadId()
  const { setSelectedModel, setUserActiveRun, refreshThreads } = useAgentWorkspace()
  const handleAuthenticationFailure = useAuthenticationFailure()

  const [interruptedNotice, setInterruptedNotice] = useState<string | null>(null)
  const [resumeNotice, setResumeNotice] = useState<string | null>(null)

  useEffect(() => {
    if (skipHydrationRef.current) {
      skipHydrationRef.current = false
      return
    }

    let cancelled = false
    const resumeAbort = new AbortController()

    void (async () => {
      try {
        if (!activeThreadId) {
          api.thread().reset([])
          setInterruptedNotice(null)
          setResumeNotice(null)
          onContextBudget(null)
          onContextSummary(null)
          onResetCompressionEvents()
          onSandboxSnapshot(null)
          return
        }
        const thread = await client.agent.threads.get(activeThreadId)
        if (cancelled) return
        setSelectedModel(thread.model)
        onContextSummary(thread.contextSummary)
        onContextBudget(null)
        onResetCompressionEvents()

        if (isResumableActiveRun(thread.activeRun)) {
          onSandboxStatus('creating')
          setUserActiveRun(thread.activeRun)
          setInterruptedNotice(null)
          setResumeNotice('运行仍在进行，正在按事件游标恢复…')
          api.thread().reset(agentMessagesToThreadMessages(thread.messages))

          let view = initialAgentRunViewState()
          let afterSequence = -1
          let sandboxFailed = false
          let sandboxId: string | undefined
          for await (const event of client.agent.runs.subscribe(thread.activeRun.id, {
            after: -1,
            signal: resumeAbort.signal,
          })) {
            if (cancelled) return
            view = foldEventsFromCursor([event], afterSequence, view)
            if (event.type === 'context-budget') onContextBudget(event)
            if (event.type === 'context-compressed') onCompressionEvent(event)
            if (event.type === 'sandbox-status') {
              sandboxFailed = event.status === 'failed'
              if (event.sandboxId) sandboxId = event.sandboxId
              onSandboxStatus(event.status, event.sandboxId)
            }
            afterSequence = event.sequence
            api
              .thread()
              .reset(
                agentMessagesToThreadMessages(
                  mergeThreadMessagesWithRunView(thread.messages, view),
                ),
              )
            if (event.type === 'run-terminal') {
              if (!sandboxFailed && sandboxId) {
                onSandboxSnapshot({
                  id: sandboxId,
                  status: 'idle',
                  createdAt: new Date().toISOString(),
                  lastUsedAt: new Date().toISOString(),
                  expiresAt: new Date().toISOString(),
                })
              }
              setResumeNotice(null)
              setUserActiveRun(null)
              void refreshThreads().catch(() => undefined)
              return
            }
          }
          return
        }

        const interrupted = thread.lastRun?.status === 'interrupted'
        setResumeNotice(null)
        setInterruptedNotice(
          interrupted ? '上次运行因服务重启中断，未自动重放模型或工具。可继续发送新任务。' : null,
        )
        if (thread.activeRun) setUserActiveRun(thread.activeRun)
        else setUserActiveRun(null)
        onSandboxSnapshot(thread.sandbox)
        api.thread().reset(
          agentMessagesToThreadMessages(thread.messages, {
            lastRunStatus: thread.lastRun?.status ?? null,
          }),
        )
      } catch (error) {
        if (!cancelled && !resumeAbort.signal.aborted) handleAuthenticationFailure(error)
      }
    })()

    return () => {
      cancelled = true
      resumeAbort.abort()
    }
  }, [activeThreadId])

  if (interruptedNotice) return <AgentInterruptedBanner message={interruptedNotice} />
  if (resumeNotice) return <AgentInterruptedBanner message={resumeNotice} />
  return null
}

function AgentContextBudgetBadge({
  budget,
  summary,
}: {
  budget: AgentContextBudgetState | null
  summary: AgentContextSummary | null
}) {
  if (!budget && !summary) return null
  const percentage = budget
    ? Math.min(999, Math.round((budget.usedTokens / Math.max(1, budget.usableTokens)) * 100))
    : null
  return (
    <details className="mx-1 rounded-xl border border-line/80 bg-surface-inset/60 px-3 py-2 text-xs text-ink-muted">
      <summary className="cursor-pointer select-none font-semibold text-ink">
        {percentage === null
          ? '上下文摘要可用'
          : `上下文 ${budget?.estimated ? '约 ' : ''}${percentage}% · ${budget?.level}`}
      </summary>
      {budget ? (
        <p className="mt-2 tabular-nums">
          {budget.usedTokens.toLocaleString()} / {budget.usableTokens.toLocaleString()} 可用 Token
          （模型窗口 {budget.contextWindowTokens.toLocaleString()}）
        </p>
      ) : null}
      {summary ? <AgentSummaryDetail summary={summary} /> : null}
    </details>
  )
}

function AgentContextTimeline({
  events,
  summary,
}: {
  events: Extract<AgentStreamEvent, { type: 'context-compressed' }>[]
  summary: AgentContextSummary | null
}) {
  if (events.length === 0) return null
  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-3" aria-label="上下文压缩时间线">
      {events.map((event) => (
        <details
          key={`${event.runId}-${event.sequence}`}
          className="rounded-xl border border-dashed border-line bg-surface px-3 py-2 text-xs text-ink-muted"
        >
          <summary className="cursor-pointer font-semibold text-ink">
            上下文已
            {event.level === 'forced'
              ? '强制摘要'
              : event.level === 'moderate'
                ? '中度压缩'
                : '轻量压缩'}
            {event.revision ? ` · 摘要 r${event.revision}` : ''}
          </summary>
          <p className="mt-1">{event.notes.join(' · ')}</p>
          {event.summaryId && summary?.id === event.summaryId ? (
            <AgentSummaryDetail summary={summary} />
          ) : null}
        </details>
      ))}
    </div>
  )
}

function AgentSummaryDetail({ summary }: { summary: AgentContextSummary }) {
  const content = summary.content
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-2 text-left">
      <p>
        摘要 revision {summary.revision} · 覆盖至消息 #{summary.coveredThroughSequence}
      </p>
      <SummaryItems label="用户目标" values={content.userGoals} />
      <SummaryItems label="用户约束" values={content.userConstraints} />
      <SummaryItems label="开放问题" values={content.openQuestions} />
      <SummaryItems label="压缩说明" values={content.compressionNotes} />
      {content.recentOutcome ? (
        <p>
          <span className="font-semibold text-ink">最近结果：</span>
          {content.recentOutcome}
        </p>
      ) : null}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-inset p-2 text-[0.68rem]">
        {JSON.stringify(content, null, 2)}
      </pre>
    </div>
  )
}

function SummaryItems({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <p>
      <span className="font-semibold text-ink">{label}：</span>
      {values.join('；')}
    </p>
  )
}

function AgentStopButton() {
  const { userActiveRun, setUserActiveRun, refreshThreads } = useAgentWorkspace()
  const handleAuthenticationFailure = useAuthenticationFailure()
  const isRunning = useAuiState(({ thread }) => thread.isRunning)
  const [stopping, setStopping] = useState(false)

  const runId = userActiveRun?.id ?? null
  if (!isRunning && !runId) return null

  const requestCancel = () => {
    if (!runId || stopping) return
    setStopping(true)
    void client.agent.runs
      .cancel(runId)
      .then((run) => {
        setUserActiveRun(run)
        void refreshThreads().catch(() => undefined)
      })
      .catch((error) => {
        handleAuthenticationFailure(error)
        setStopping(false)
      })
  }

  const className = cn(
    'grid h-9 w-auto place-items-center rounded-full bg-[#2c2540] px-3 text-[0.7rem] font-bold text-white transition-[background,transform] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:bg-surface-inset dark:text-ink',
    'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3',
  )

  if (isRunning) {
    return (
      <ComposerPrimitive.Cancel className={className} disabled={stopping} onClick={requestCancel}>
        {stopping ? '停止中…' : '停止'}
      </ComposerPrimitive.Cancel>
    )
  }

  return (
    <button type="button" className={className} disabled={stopping} onClick={requestCancel}>
      {stopping ? '停止中…' : '停止'}
    </button>
  )
}

const WebFetchToolUI = makeAssistantToolUI<
  { url?: string },
  { summary?: string; status?: string; audit?: Record<string, unknown> }
>({
  toolName: 'web_fetch',
  render: ({ args, result, status, isError }) => {
    const url = typeof args.url === 'string' ? args.url : ''
    const finalUrl = typeof result?.audit?.finalUrl === 'string' ? result.audit.finalUrl : undefined
    const httpStatus = typeof result?.audit?.status === 'number' ? result.audit.status : undefined

    if (status.type === 'running') return <AgentToolCall url={url} />

    return (
      <AgentToolResult
        isError={Boolean(isError)}
        status={result?.status ?? (isError ? 'failed' : 'succeeded')}
        httpStatus={httpStatus}
        summary={result?.summary}
        finalUrl={finalUrl}
      />
    )
  },
})

interface SandboxToolResult {
  summary?: string
  status?: string
  audit?: Record<string, unknown>
}

function isSandboxToolResult(value: unknown): value is SandboxToolResult {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ShellToolUI = makeAssistantToolUI<
  { command?: string; workingDirectory?: string },
  SandboxToolResult
>({
  toolName: 'shell',
  render: ({ args, result, status, isError }) => (
    <SandboxToolActivityCard
      toolName="shell"
      subject={args.command}
      detail={args.workingDirectory}
      result={result}
      running={status.type === 'running'}
      isError={Boolean(isError)}
    />
  ),
})

const ReadFileToolUI = makeAssistantToolUI<{ path?: string }, SandboxToolResult>({
  toolName: 'read_file',
  render: ({ args, result, status, isError }) => (
    <SandboxToolActivityCard
      toolName="read_file"
      subject={args.path}
      result={result}
      running={status.type === 'running'}
      isError={Boolean(isError)}
    />
  ),
})

const WriteFileToolUI = makeAssistantToolUI<{ path?: string }, SandboxToolResult>({
  toolName: 'write_file',
  render: ({ args, result, status, isError }) => (
    <SandboxToolActivityCard
      toolName="write_file"
      subject={args.path}
      result={result}
      running={status.type === 'running'}
      isError={Boolean(isError)}
    />
  ),
})

const ExportFileToolUI = makeAssistantToolUI<{ path?: string }, SandboxToolResult>({
  toolName: 'export_file',
  render: ({ args, result, status, isError }) => {
    if (status.type === 'running') {
      return (
        <SandboxToolActivityCard
          toolName="export_file"
          subject={args.path}
          running
          isError={false}
        />
      )
    }
    return <ArtifactCard path={args.path} result={result} isError={Boolean(isError)} />
  },
})

function ArtifactCard({
  path,
  result,
  isError,
}: {
  path?: string | undefined
  result?: SandboxToolResult | undefined
  isError: boolean
}) {
  const file = parseAgentOutputFileReference(result?.audit)

  if (isError || !file) {
    return (
      <SandboxToolActivityCard
        toolName="export_file"
        subject={path}
        result={result}
        running={false}
        isError
      />
    )
  }
  const previewable = file.mimeType.startsWith('image/')

  return (
    <figure className="my-3 overflow-hidden rounded-2xl border border-line bg-surface-card shadow-[0_14px_38px_rgb(37_57_103/0.09)]">
      {previewable ? (
        // 预览地址是经过 owner 校验、CSP sandbox 与 nosniff 保护的同源文件接口。
        <img
          src={file.contentUrl}
          alt={file.name}
          className="max-h-[28rem] w-full bg-white object-contain"
        />
      ) : null}
      <figcaption className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {file.mimeType} · {formatFileSize(file.sizeBytes)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={file.contentUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
          >
            查看
          </a>
          <a
            href={file.downloadUrl}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hover"
          >
            下载
          </a>
        </div>
      </figcaption>
    </figure>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function SandboxToolActivityCard({
  toolName,
  subject,
  detail,
  result,
  running,
  isError,
}: {
  toolName: 'shell' | 'read_file' | 'write_file' | 'export_file'
  subject?: string | undefined
  detail?: string | undefined
  result?: SandboxToolResult | undefined
  running: boolean
  isError: boolean
}) {
  const state = resolveAgentToolActivityState({
    running,
    status: result?.status,
    isError,
    audit: result?.audit,
  })
  const exitCode = typeof result?.audit?.exitCode === 'number' ? result.audit.exitCode : undefined
  const size = typeof result?.audit?.size === 'number' ? result.audit.size : undefined
  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-xl border bg-surface text-sm',
        toolStateClassName(state),
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-current/10 px-3 py-2">
        <span className="font-mono text-xs font-bold">{toolName}</span>
        <span className="rounded-full bg-current/8 px-2 py-0.5 text-[0.68rem] font-bold">
          {AGENT_TOOL_ACTIVITY_LABELS[state]}
        </span>
        {exitCode !== undefined ? (
          <span className="font-mono text-[0.7rem] opacity-70">exit {exitCode}</span>
        ) : null}
        {size !== undefined ? (
          <span className="font-mono text-[0.7rem] opacity-70">{size} B</span>
        ) : null}
      </div>
      <div className="space-y-1 px-3 py-2">
        {subject ? (
          <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-ink">
            {subject}
          </code>
        ) : null}
        {detail ? <p className="font-mono text-[0.68rem] text-ink-subtle">{detail}</p> : null}
        {result?.summary ? <p className="text-xs text-ink-muted">{result.summary}</p> : null}
      </div>
    </div>
  )
}

function AgentMcpStatusPanel({
  statuses,
  loadState,
}: {
  statuses: AgentMcpServerStatus[]
  loadState: 'loading' | 'ready' | 'failed'
}) {
  const summary = summarizeAgentMcpStatuses(statuses)
  return (
    <details className="mx-1 rounded-xl border border-line/80 bg-surface-inset/60 px-3 py-2 text-xs text-ink-muted">
      <summary className="cursor-pointer font-semibold text-ink">
        MCP Servers ·{' '}
        {loadState === 'loading'
          ? '检查中'
          : loadState === 'failed'
            ? '状态不可用'
            : `${summary.readyCount}/${summary.serverCount} ready · ${summary.registeredToolCount} tools`}
      </summary>
      {loadState === 'ready' && statuses.length === 0 ? (
        <p className="mt-2 text-ink-subtle">未配置平台 MCP Server。</p>
      ) : null}
      {statuses.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {statuses.map((server) => (
            <li key={server.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{server.name}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[0.68rem] font-bold',
                  server.status === 'ready'
                    ? 'bg-[#dff2e6] text-[#2f7a4d] dark:bg-[#193426]'
                    : 'bg-[#f6dddd] text-[#a63d3d] dark:bg-[#3d2222]',
                )}
              >
                {server.status}
              </span>
              <span className="font-mono text-[0.68rem] text-ink-subtle">
                {server.registeredToolCount}/{server.allowedToolCount} tools
                {server.errorCode ? ` · ${server.errorCode}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  )
}

function McpToolActivityCard({
  serverId,
  remoteToolName,
  args,
  result,
  running,
  isError,
}: {
  serverId: string
  remoteToolName: string
  args: Record<string, unknown>
  result?: SandboxToolResult | undefined
  running: boolean
  isError: boolean
}) {
  const state = resolveAgentToolActivityState({
    running,
    status: result?.status,
    isError,
    audit: result?.audit,
  })
  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-xl border bg-surface text-sm',
        toolStateClassName(state),
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-current/10 px-3 py-2">
        <span className="font-mono text-xs font-bold">
          {serverId} · {remoteToolName}
        </span>
        <span className="rounded-full bg-current/8 px-2 py-0.5 text-[0.68rem] font-bold">
          {AGENT_TOOL_ACTIVITY_LABELS[state]}
        </span>
      </div>
      <div className="space-y-1 px-3 py-2">
        <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-ink">
          {JSON.stringify(args)}
        </code>
        {result?.summary ? <p className="text-xs text-ink-muted">{result.summary}</p> : null}
      </div>
    </div>
  )
}

function toolStateClassName(state: AgentToolActivityState): string {
  if (state === 'failed') return 'border-[#e3b3b3] text-[#a63d3d]'
  if (state === 'cancelled') return 'border-ink-subtle/30 text-ink-subtle'
  if (state === 'limit') return 'border-[#d7b56d] text-[#8b6418]'
  if (state === 'success') return 'border-[#9dc7ae] text-[#2f7a4d]'
  return 'border-brand/30 text-brand'
}

function AgentMessageMetadata() {
  const custom = useAuiState(({ message }) => message.metadata.custom) as AgentRunMetadataType
  return (
    <AgentRunMetadata
      model={custom.model}
      runStatus={custom.runStatus}
      totalTokens={custom.totalTokens}
      modelCalls={custom.modelCalls}
      toolCalls={custom.toolCalls}
    />
  )
}

function isTextModelAlias(value: string): value is TextModelAlias {
  return ['qwen', 'glm', 'deepseek', 'kimi'].includes(value)
}
