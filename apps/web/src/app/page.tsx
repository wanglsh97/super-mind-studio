'use client';

import { createAIGatewayClient, parseAgentOutputFileReference } from '@supermind/sdk';
import type {
  AgentContextSummary,
  AgentMcpServerStatus,
  AgentSandboxStatus,
  AgentSkillCandidate,
  AgentStreamEvent,
  AgentThread,
  AgentThreadSandbox,
  TextModelAlias,
  TextModelId,
} from '@supermind/sdk';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  defineToolkit,
  ThreadPrimitive,
  Tools,
  type ToolDefinition,
  useAui,
  useAuiState,
  useLocalRuntime,
  WebSpeechDictationAdapter,
} from '@assistant-ui/react';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { AgentSkillSlashPicker } from '@/components/agent-skill-slash-picker';
import {
  AgentActiveRunHint,
  AgentComposerActions,
  AgentComposerDock,
  AgentComposerFooter,
  AgentComposerInput,
  AgentComposerRoot,
  AgentComposerSubmitGroup,
  AgentConsolePanel,
  AgentDictationButton,
  AgentDictationTranscript,
  AgentDisclosureChevron,
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
  ThinkingEffortSelect,
  NewThreadButton,
  UserMessage,
} from '@/components/chat-thread-ui';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';
import { ProtectedUserPage } from '@/components/protected-user-page';
import { useAgentActiveThreadId } from '@/hooks/use-agent-active-thread-id';
import { useAgentWorkspace } from '@/hooks/use-agent-workspace';
import { useAuthenticationFailure } from '@/hooks/use-authentication-failure';
import { cn } from '@/utils/cn';
import {
  agentMessagesToThreadMessages,
  createAgentRunAdapter,
  type AgentRunMetadata as AgentRunMetadataType,
  type AgentRunProgressStage,
} from '@/utils/agent/agent-run-adapter';
import { shouldStartNewThreadOnModelChange } from '@/utils/agent/agent-model-policy';
import { resetThreadIfIdle } from '@/utils/agent/agent-thread-hydration';
import {
  foldEventsFromCursor,
  isResumableActiveRun,
  mergeThreadMessagesWithRunView,
} from '@/utils/agent/agent-run-resume';
import { activeRunForThread } from '@/utils/agent/agent-active-runs';
import { initialAgentRunViewState } from '@/utils/agent/agent-run-reducer';
import { threadTokenUsagePercentage } from '@/utils/agent/agent-thread-token-usage';
import { resolveAgentToolActivityState, type AgentToolActivityState } from '@/utils/agent/agent-tool-activity';
import { parseNamespacedMcpToolName, summarizeAgentMcpStatuses } from '@/utils/agent/agent-mcp-status';

const client = createAIGatewayClient();

interface ModelOption {
  value: TextModelId;
  label: string;
  provider: TextModelAlias;
}

export default function AgentPage() {
  return (
    <ProtectedUserPage>
      <Suspense fallback={<AgentPageShell aria-busy="true" />}>
        <AgentConsole />
      </Suspense>
    </ProtectedUserPage>
  );
}

function AgentConsole() {
  const handleAuthenticationFailure = useAuthenticationFailure();
  const {
    models,
    selectedModel,
    setSelectedModel,
    thinkingEffort,
    setThinkingEffort,
    openThread,
    prependThread,
    startNewThread,
    refreshThreads,
    activeRuns,
    upsertActiveRun,
    removeActiveRun,
  } = useAgentWorkspace();
  const activeThreadId = useAgentActiveThreadId();
  const [threadTokenUsage, setThreadTokenUsage] = useState<AgentThread['tokenUsage'] | null>(null);
  const [contextSummary, setContextSummary] = useState<AgentContextSummary | null>(null);
  const [compressionEvents, setCompressionEvents] = useState<
    Extract<AgentStreamEvent, { type: 'context-compressed' }>[]
  >([]);
  const [skillCandidates, setSkillCandidates] = useState<AgentSkillCandidate[]>([]);
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [skillLoadState, setSkillLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [mcpServers, setMcpServers] = useState<AgentMcpServerStatus[]>([]);
  const [mcpLoadState, setMcpLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [sandboxTelemetry, setSandboxTelemetry] = useState<SandboxTelemetry>({ status: 'idle' });
  const [runProgress, setRunProgress] = useState<AgentRunProgressStage | null>(null);

  const skipHydrationRef = useRef(false);
  const contextRef = useRef({
    threadId: activeThreadId as string | null,
    model: selectedModel,
    thinkingEffort,
    selectedSkillNames: [] as readonly string[],
    onThreadCreated: (() => undefined) as (thread: Parameters<typeof prependThread>[0]) => void,
    onRunCreated: (() => undefined) as (run: { id: string; threadId: string }) => void,
    onRunFinished: () => undefined,
    onContextCompressed: (() => undefined) as (
      event: Extract<AgentStreamEvent, { type: 'context-compressed' }>,
    ) => void,
    onSandboxStatus: (() => undefined) as (status: AgentSandboxStatus, sandboxId?: string) => void,
    onRunProgressChange: (() => undefined) as (stage: AgentRunProgressStage | null) => void,
  });

  contextRef.current.threadId = activeThreadId;
  contextRef.current.model = selectedModel;
  contextRef.current.thinkingEffort = thinkingEffort;
  contextRef.current.selectedSkillNames = selectedSkillNames;
  contextRef.current.onThreadCreated = (thread) => {
    skipHydrationRef.current = true;
    setThreadTokenUsage(null);
    setContextSummary(null);
    setCompressionEvents([]);
    prependThread(thread);
    openThread(thread.id);
  };
  contextRef.current.onRunCreated = (run) => {
    setSandboxTelemetry({ status: 'creating' });
    upsertActiveRun({
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
    });
  };
  contextRef.current.onRunFinished = () => {
    setRunProgress(null);
    setSandboxTelemetry((current) =>
      current.status === 'failed'
        ? current
        : current.status === 'ready'
          ? current.sandboxId
            ? { status: 'standby', sandboxId: current.sandboxId }
            : { status: 'idle' }
          : { status: 'idle' },
    );
    if (activeThreadId) {
      removeActiveRun(activeThreadId);
      void client.agent.threads
        .get(activeThreadId)
        .then((thread) => {
          setThreadTokenUsage(thread.tokenUsage);
          setContextSummary(thread.contextSummary);
        })
        .catch(() => undefined);
    }
    void refreshThreads().catch(() => undefined);
  };
  contextRef.current.onContextCompressed = (event) => {
    setCompressionEvents((current) => [...current, event]);
    if (event.summaryId && contextRef.current.threadId) {
      void client.agent.threads
        .get(contextRef.current.threadId)
        .then((thread) => {
          setContextSummary(thread.contextSummary);
        })
        .catch(() => undefined);
    }
  };
  contextRef.current.onSandboxStatus = (status, sandboxId) => {
    setSandboxTelemetry({
      status,
      ...(sandboxId === undefined ? {} : { sandboxId }),
    });
  };
  contextRef.current.onRunProgressChange = setRunProgress;

  const loadSkillCandidates = () => {
    setSkillLoadState('loading');
    return client.agent.skills
      .candidates()
      .then((items) => {
        setSkillCandidates(items);
        setSelectedSkillNames((current) =>
          current.filter((name) => items.some((item) => item.name === name)),
        );
        setSkillLoadState('ready');
      })
      .catch((error) => {
        handleAuthenticationFailure(error);
        setSkillLoadState('failed');
      });
  };

  useEffect(() => {
    void loadSkillCandidates();
    void client.agent.mcp
      .servers()
      .then((servers) => {
        setMcpServers(servers);
        setMcpLoadState('ready');
      })
      .catch((error) => {
        handleAuthenticationFailure(error);
        setMcpLoadState('failed');
      });
  }, []);

  const modelOptions = useMemo<ModelOption[]>(
    () =>
      models.flatMap((model) =>
        isTextModelAlias(model.alias)
          ? [{ value: model.id as TextModelId, label: model.displayName, provider: model.alias }]
          : [],
      ),
    [models],
  );

  const handleModelChange = (nextModel: TextModelId) => {
    const current = (selectedModel as TextModelId) || modelOptions[0]?.value || 'qwen3.7-plus';
    const leaveThread = shouldStartNewThreadOnModelChange(activeThreadId, current, nextModel);
    setSelectedModel(nextModel);
    if (leaveThread) {
      skipHydrationRef.current = false;
      startNewThread();
    }
  };

  const adapter = useMemo(
    () =>
      createAgentRunAdapter(
        client,
        () => contextRef.current,
        (error) => {
          handleAuthenticationFailure(error);
        },
      ),
    [handleAuthenticationFailure],
  );

  const feedbackAdapter = useMemo(
    () => ({
      submit: () => undefined,
    }),
    [],
  );
  // TODO(api): 接入服务端 STT 后，以自定义 DictationAdapter 替换浏览器 Web Speech 实现。
  const dictationAdapter = useMemo(
    () => new WebSpeechDictationAdapter({ language: 'zh-CN', continuous: true, interimResults: true }),
    [],
  );
  const [dictationSupported, setDictationSupported] = useState(false);
  useEffect(() => {
    setDictationSupported(WebSpeechDictationAdapter.isSupported());
  }, []);
  const runtimeAdapters = useMemo(
    () => ({
      feedback: feedbackAdapter,
      dictation: dictationAdapter,
    }),
    [dictationAdapter, feedbackAdapter],
  );
  const runtime = useLocalRuntime(adapter, { adapters: runtimeAdapters });
  const aui = useAui({ tools: Tools({ toolkit: agentToolUiToolkit }) });
  const modelDisabled = modelOptions.length === 0;
  const currentActiveRun = activeRunForThread(activeRuns, activeThreadId);
  const submitBlocked = modelDisabled || currentActiveRun !== null;

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <ThreadHydrator
        skipHydrationRef={skipHydrationRef}
        onTokenUsage={setThreadTokenUsage}
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
      <AgentPageShell>
        <AgentConsolePanel label="智能体">
          <AgentEnvironmentPanel
            sandbox={sandboxTelemetry}
            mcpServers={mcpServers}
            mcpLoadState={mcpLoadState}
            skillCandidates={skillCandidates}
            selectedSkillNames={selectedSkillNames}
            skillLoadState={skillLoadState}
            tokenUsage={threadTokenUsage}
          />
          <AgentThreadRoot>
            <AgentThreadViewport>
              <AuiIf condition={(state) => state.thread.isEmpty}>
                <AgentEmptyState
                  kicker="AGENT THREAD · EMPTY"
                  title="交给 Agent 一个可执行的任务"
                />
              </AuiIf>
              <ThreadPrimitive.Messages>
                {({ message }) =>
                  message.role === 'user' ? (
                    <UserMessage />
                  ) : (
                    <AssistantMessage
                      label="AGENT"
                      runProgress={runProgress}
                      metadata={<AgentMessageMetadata />}
                      renderPart={(part) => {
                        if (part.type === 'tool-call') {
                          if (part.toolUI) return part.toolUI;
                          const toolPart = part as typeof part & {
                            toolName?: unknown;
                            args?: unknown;
                            result?: unknown;
                            isError?: unknown;
                          };
                          if (typeof toolPart.toolName !== 'string') return null;
                          const parsed = parseNamespacedMcpToolName(toolPart.toolName);
                          if (parsed) {
                            const result = isSandboxToolResult(toolPart.result)
                              ? toolPart.result
                              : undefined;
                            return (
                              <McpToolActivityCard
                                serverId={parsed.serverId}
                                remoteToolName={parsed.remoteToolName}
                                args={isRecord(toolPart.args) ? toolPart.args : {}}
                                result={result}
                                running={result === undefined}
                                isError={toolPart.isError === true}
                              />
                            );
                          }
                          return null;
                        }
                        if (part.type === 'text')
                          return <AssistantMarkdown>{part.text ?? ''}</AssistantMarkdown>;
                        if (part.type === 'reasoning') {
                          return (
                            <AgentReasoning
                              title="reasoning"
                              text={part.text ?? ''}
                              running={part.status?.type === 'running'}
                            />
                          );
                        }
                        return null;
                      }}
                    />
                  )
                }
              </ThreadPrimitive.Messages>
              <AgentContextTimeline events={compressionEvents} summary={contextSummary} />
            </AgentThreadViewport>
            <AgentScrollToBottom />
            <AgentComposerDock>
              {activeRuns.some((run) => run.threadId !== activeThreadId) ? (
                <AgentActiveRunHint message="其他会话正在后台运行；当前会话仍可独立提交" />
              ) : null}
              <AgentComposerRoot>
                <AgentSkillSlashPicker
                  candidates={skillCandidates}
                  selectedNames={selectedSkillNames}
                  loadState={skillLoadState}
                  disabled={currentActiveRun !== null}
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
                      : '有什么问题冲我来...'
                  }
                  disabled={submitBlocked}
                  maxLength={8000}
                />
                <AgentDictationTranscript />
                <AgentComposerFooter>
                  <AgentComposerActions>
                    <NewThreadButton onNewThread={startNewThread} />
                  </AgentComposerActions>
                  <AgentComposerSubmitGroup>
                    <ThinkingEffortSelect
                      value={thinkingEffort}
                      disabled={modelDisabled}
                      onChange={setThinkingEffort}
                    />
                    <ModelSelect
                      value={
                        (selectedModel as TextModelId) || modelOptions[0]?.value || 'qwen3.7-plus'
                      }
                      options={modelOptions}
                      disabled={modelDisabled}
                      boundHint={activeThreadId !== null}
                      onChange={handleModelChange}
                    />
                    {dictationSupported ? <AgentDictationButton disabled={submitBlocked} /> : null}
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
  );
}

type SandboxTelemetry =
  | { status: 'idle' }
  | { status: 'standby'; sandboxId: string }
  | { status: AgentSandboxStatus; sandboxId?: string };

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
};

function AgentEnvironmentPanel({
  sandbox,
  mcpServers,
  mcpLoadState,
  skillCandidates,
  selectedSkillNames,
  skillLoadState,
  tokenUsage,
}: {
  sandbox: SandboxTelemetry;
  mcpServers: AgentMcpServerStatus[];
  mcpLoadState: 'loading' | 'ready' | 'failed';
  skillCandidates: AgentSkillCandidate[];
  selectedSkillNames: string[];
  skillLoadState: 'loading' | 'ready' | 'failed';
  tokenUsage: AgentThread['tokenUsage'] | null;
}) {
  const sandboxCopy = SANDBOX_STATUS_COPY[sandbox.status];
  const sandboxId = 'sandboxId' in sandbox ? sandbox.sandboxId : undefined;
  const shortId = sandboxId
    ? sandboxId.length > 16
      ? `${sandboxId.slice(0, 7)}…${sandboxId.slice(-5)}`
      : sandboxId
    : null;
  const mcpSummary = summarizeAgentMcpStatuses(mcpServers);
  const contextPercentage = tokenUsage ? threadTokenUsagePercentage(tokenUsage) : null;
  const hasFailure =
    sandbox.status === 'failed' || mcpLoadState === 'failed' || skillLoadState === 'failed';
  const hasLoaded = mcpLoadState === 'ready' && skillLoadState === 'ready';
  const isReady = (sandbox.status === 'standby' || sandbox.status === 'ready') && hasLoaded;
  const overallLabel = hasFailure
    ? '部分异常'
    : isReady
      ? '环境就绪'
      : hasLoaded
        ? '环境待命'
        : '状态检查中';
  const overallDot = hasFailure
    ? 'bg-danger'
    : isReady
      ? 'bg-success'
      : hasLoaded
        ? 'bg-ink-subtle/45'
        : 'bg-brand animate-status-breathe';
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <aside
      aria-live="polite"
      aria-label={`运行环境：${overallLabel}`}
      className={cn(
        'liquid-glass fixed top-4 right-4 z-30 overflow-hidden border-line/80 shadow-[0_24px_70px_rgb(41_54_88/0.18)] transition-[width,border-radius] duration-200 motion-reduce:transition-none',
        isCollapsed ? 'w-44 rounded-[1rem]' : 'w-[22rem] rounded-[1.35rem] p-2',
      )}
    >
      {isCollapsed ? (
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-surface-card/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
          aria-label="展开运行环境"
          aria-expanded="false"
          onClick={() => setIsCollapsed(false)}
        >
          <span
            aria-hidden="true"
            className="relative grid size-8 shrink-0 place-items-center rounded-[0.7rem] bg-surface-inset text-ink-muted"
          >
            <EnvironmentIcon />
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface-card',
                overallDot,
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-ink">运行环境</span>
            <span className="mt-0.5 block text-[0.6rem] text-ink-subtle">{overallLabel}</span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="size-4 shrink-0 -rotate-90 fill-none stroke-current stroke-[1.7] text-ink-subtle"
          >
            <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <>
          <header className="flex items-start justify-between gap-4 px-3 pt-2.5 pb-3">
            <div>
              <p className="font-mono text-[0.58rem] font-bold tracking-[0.18em] text-brand">
                RUNTIME TELEMETRY
              </p>
              <h2 className="mt-1 text-base font-bold text-ink">运行环境</h2>
              <p className="mt-1 text-xs text-ink-muted">当前会话可用的工具、资源与上下文。</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'rounded-full px-2 py-1 text-[0.62rem] font-bold',
                  hasFailure
                    ? 'bg-danger/10 text-danger'
                    : isReady
                      ? 'bg-success/10 text-success'
                      : 'bg-brand/10 text-brand',
                )}
              >
                {overallLabel}
              </span>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-lg text-ink-subtle transition hover:bg-surface-inset hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                aria-label="折叠运行环境"
                aria-expanded="true"
                onClick={() => setIsCollapsed(true)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="size-4 fill-none stroke-current stroke-[1.7]"
                >
                  <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </header>

          <div className="overflow-hidden rounded-[1rem] border border-line/75 bg-surface-card/70">
            <EnvironmentRow
              icon={<SandboxIcon />}
              label="Sandbox"
              value={sandboxCopy.label}
              valueClassName={sandboxCopy.tone}
              detail={shortId ?? sandboxCopy.note}
              dotClassName={sandboxCopy.dot}
              title={sandboxId ? `Sandbox ID: ${sandboxId}` : sandboxCopy.note}
            />
            <EnvironmentRow
              icon={<McpIcon />}
              label="插件"
              detail=""
              value={
                mcpLoadState === 'loading'
                  ? '检查中'
                  : mcpLoadState === 'failed'
                    ? '状态不可用'
                    : mcpSummary.serverCount === 0
                      ? '未配置'
                      : `${mcpSummary.readyCount}/${mcpSummary.serverCount} 就绪`
              }
              valueClassName={mcpLoadState === 'failed' ? 'text-danger' : 'text-ink'}
              dotClassName={
                mcpLoadState === 'failed'
                  ? 'bg-danger'
                  : mcpLoadState === 'ready'
                    ? 'bg-success'
                    : 'bg-brand animate-status-breathe'
              }
            >
              {mcpLoadState === 'ready' && mcpServers.length === 0 ? (
                <p className="mt-2 text-[0.68rem] text-ink-subtle">未配置平台插件。</p>
              ) : null}
            </EnvironmentRow>
            <EnvironmentRow
              icon={<SkillIcon />}
              label="技能"
              value={
                skillLoadState === 'loading'
                  ? '加载中'
                  : skillLoadState === 'failed'
                    ? '加载失败'
                    : `${selectedSkillNames.length} 个`
              }
              valueClassName={skillLoadState === 'failed' ? 'text-danger' : 'text-ink'}
              detail={
                skillLoadState === 'ready' ? `${skillCandidates.length} 个可用` : '等待技能目录'
              }
              dotClassName={
                skillLoadState === 'failed'
                  ? 'bg-danger'
                  : skillLoadState === 'ready'
                    ? 'bg-success'
                    : 'bg-brand animate-status-breathe'
              }
            >
              {selectedSkillNames.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/70 pt-2">
                  {selectedSkillNames.map((name) => (
                    <span
                      key={name}
                      className="rounded-full border border-brand/15 bg-brand/7 px-2 py-1 font-mono text-[0.62rem] text-brand"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
            </EnvironmentRow>
            <EnvironmentRow
              icon={<ContextIcon />}
              label="Context"
              value={
                tokenUsage
                  ? contextPercentage === null
                    ? '上下文未知'
                    : `${tokenUsage.estimated ? '约 ' : ''}${contextPercentage}%`
                  : '等待会话'
              }
              valueClassName={
                contextPercentage !== null && contextPercentage >= 90
                  ? 'text-danger'
                  : contextPercentage !== null && contextPercentage >= 70
                    ? 'text-brand'
                    : 'text-ink'
              }
              detail={
                tokenUsage
                  ? tokenUsage.contextWindowTokens === null
                    ? `${tokenUsage.totalTokens.toLocaleString()} tokens · 模型上下文未知`
                    : `${tokenUsage.totalTokens.toLocaleString()} / ${tokenUsage.contextWindowTokens.toLocaleString()} tokens`
                  : '选择或创建 Thread 后显示'
              }
              dotClassName={
                contextPercentage !== null && contextPercentage >= 90
                  ? 'bg-danger'
                  : tokenUsage
                    ? 'bg-brand'
                    : 'bg-ink-subtle/45'
              }
            >
              {contextPercentage !== null ? (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-inset"
                  aria-label={`上下文占用 ${contextPercentage}%`}
                >
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      contextPercentage >= 90 ? 'bg-danger' : 'bg-brand',
                    )}
                    style={{ width: `${Math.min(100, contextPercentage)}%` }}
                  />
                </div>
              ) : null}
            </EnvironmentRow>
          </div>
        </>
      )}
    </aside>
  );
}

function EnvironmentRow({
  icon,
  label,
  value,
  detail,
  dotClassName,
  valueClassName,
  title,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  dotClassName: string;
  valueClassName?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="grid grid-cols-[2.25rem_1fr_auto] gap-x-3 border-b border-line/70 px-3 py-3 last:border-b-0"
      title={title}
    >
      <span
        aria-hidden="true"
        className="row-span-2 grid size-9 place-items-center rounded-xl bg-surface-inset text-ink-muted"
      >
        {icon}
      </span>
      <span className="self-end font-mono text-[0.56rem] font-bold tracking-[0.13em] text-ink-subtle uppercase">
        {label}
      </span>
      <span className="flex items-center gap-1.5 self-end">
        <span className={cn('size-1.5 rounded-full', dotClassName)} />
        <span className={cn('text-xs font-bold', valueClassName)}>{value}</span>
      </span>
      <span className="truncate text-[0.68rem] text-ink-subtle">{detail}</span>
      {children ? <div className="col-span-2 col-start-2">{children}</div> : null}
    </section>
  );
}

function EnvironmentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.15rem] fill-none stroke-current stroke-[1.6]">
      <path d="M5 6.5h14v11H5z" strokeLinejoin="round" />
      <path d="M8 10h3M8 13.5h5M16 10h.01" strokeLinecap="round" />
    </svg>
  );
}

function SandboxIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.05rem] fill-none stroke-current stroke-[1.6]">
      <path d="m4.5 7.5 7.5-4 7.5 4-7.5 4-7.5-4Z" strokeLinejoin="round" />
      <path d="M4.5 7.5v8.7l7.5 4.3 7.5-4.3V7.5M12 11.5v9" strokeLinejoin="round" />
    </svg>
  );
}

function McpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.05rem] fill-none stroke-current stroke-[1.7]">
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="m9 8.5 2 6M15 8.5l-2 6" />
    </svg>
  );
}

function SkillIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.05rem] fill-none stroke-current stroke-[1.7]">
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="m18.5 16 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </svg>
  );
}

function ContextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.05rem] fill-none stroke-current stroke-[1.7]">
      <path d="M5 6h14M5 10h10M5 14h12M5 18h7" strokeLinecap="round" />
    </svg>
  );
}

function toSandboxTelemetry(sandbox: AgentThreadSandbox | null): SandboxTelemetry {
  if (!sandbox) return { status: 'idle' };
  if (sandbox.status === 'idle' || sandbox.status === 'ready') {
    return { status: 'standby', sandboxId: sandbox.id };
  }
  return { status: sandbox.status, sandboxId: sandbox.id };
}

function ThreadHydrator({
  skipHydrationRef,
  onTokenUsage,
  onContextSummary,
  onCompressionEvent,
  onResetCompressionEvents,
  onSandboxStatus,
  onSandboxSnapshot,
}: {
  skipHydrationRef: { current: boolean };
  onTokenUsage: (usage: AgentThread['tokenUsage'] | null) => void;
  onContextSummary: (summary: AgentContextSummary | null) => void;
  onCompressionEvent: (event: Extract<AgentStreamEvent, { type: 'context-compressed' }>) => void;
  onResetCompressionEvents: () => void;
  onSandboxStatus: (status: AgentSandboxStatus, sandboxId?: string) => void;
  onSandboxSnapshot: (sandbox: AgentThreadSandbox | null) => void;
}) {
  const api = useAui();
  const isLocalRunRunning = useAuiState(({ thread }) => thread.isRunning);
  const activeThreadId = useAgentActiveThreadId();
  const { setSelectedModel, upsertActiveRun, removeActiveRun, refreshThreads } =
    useAgentWorkspace();
  const handleAuthenticationFailure = useAuthenticationFailure();

  const [interruptedNotice, setInterruptedNotice] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  useEffect(() => {
    // LocalRuntime owns the message repository for the duration of a local run.
    // Re-run hydration after runEnd instead of invalidating its parent-message chain.
    if (isLocalRunRunning) return;

    if (skipHydrationRef.current) {
      skipHydrationRef.current = false;
      return;
    }

    let cancelled = false;
    const resumeAbort = new AbortController();

    void (async () => {
      try {
        if (!activeThreadId) {
          resetThreadIfIdle(api.thread(), []);
          setInterruptedNotice(null);
          setResumeNotice(null);
          onTokenUsage(null);
          onContextSummary(null);
          onResetCompressionEvents();
          onSandboxSnapshot(null);
          return;
        }
        const thread = await client.agent.threads.get(activeThreadId);
        if (cancelled) return;
        setSelectedModel(thread.model);
        onContextSummary(thread.contextSummary);
        onTokenUsage(thread.tokenUsage);
        onResetCompressionEvents();

        if (isResumableActiveRun(thread.activeRun)) {
          onSandboxStatus('creating');
          upsertActiveRun(thread.activeRun);
          setInterruptedNotice(null);
          setResumeNotice('运行仍在进行，正在按事件游标恢复…');
          if (!resetThreadIfIdle(api.thread(), agentMessagesToThreadMessages(thread.messages))) {
            return;
          }

          let view = initialAgentRunViewState();
          let afterSequence = -1;
          let sandboxFailed = false;
          let sandboxId: string | undefined;
          for await (const event of client.agent.runs.subscribe(thread.activeRun.id, {
            after: -1,
            signal: resumeAbort.signal,
          })) {
            if (cancelled) return;
            view = foldEventsFromCursor([event], afterSequence, view);
            if (event.type === 'context-compressed') onCompressionEvent(event);
            if (event.type === 'sandbox-status') {
              sandboxFailed = event.status === 'failed';
              if (event.sandboxId) sandboxId = event.sandboxId;
              onSandboxStatus(event.status, event.sandboxId);
            }
            afterSequence = event.sequence;
            if (
              !resetThreadIfIdle(
                api.thread(),
                agentMessagesToThreadMessages(
                  mergeThreadMessagesWithRunView(thread.messages, view),
                ),
              )
            ) {
              return;
            }
            if (event.type === 'run-terminal') {
              if (!sandboxFailed && sandboxId) {
                onSandboxSnapshot({
                  id: sandboxId,
                  status: 'idle',
                  createdAt: new Date().toISOString(),
                  lastUsedAt: new Date().toISOString(),
                  expiresAt: new Date().toISOString(),
                });
              }
              setResumeNotice(null);
              removeActiveRun(activeThreadId);
              void refreshThreads().catch(() => undefined);
              return;
            }
          }
          return;
        }

        const interrupted = thread.lastRun?.status === 'interrupted';
        setResumeNotice(null);
        setInterruptedNotice(
          interrupted ? '上次运行因服务重启中断，未自动重放模型或工具。可继续发送新任务。' : null,
        );
        if (thread.activeRun) upsertActiveRun(thread.activeRun);
        else removeActiveRun(activeThreadId);
        onSandboxSnapshot(thread.sandbox);
        resetThreadIfIdle(
          api.thread(),
          agentMessagesToThreadMessages(thread.messages, {
            lastRunStatus: thread.lastRun?.status ?? null,
          }),
        );
      } catch (error) {
        if (!cancelled && !resumeAbort.signal.aborted) handleAuthenticationFailure(error);
      }
    })();

    return () => {
      cancelled = true;
      resumeAbort.abort();
    };
  }, [activeThreadId, isLocalRunRunning]);

  if (interruptedNotice) return <AgentInterruptedBanner message={interruptedNotice} />;
  if (resumeNotice) return <AgentInterruptedBanner message={resumeNotice} />;
  return null;
}

function AgentContextTimeline({
  events,
  summary,
}: {
  events: Extract<AgentStreamEvent, { type: 'context-compressed' }>[];
  summary: AgentContextSummary | null;
}) {
  if (events.length === 0) return null;
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
  );
}

function AgentSummaryDetail({ summary }: { summary: AgentContextSummary }) {
  const content = summary.content;
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
  );
}

function SummaryItems({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <p>
      <span className="font-semibold text-ink">{label}：</span>
      {values.join('；')}
    </p>
  );
}

function AgentStopButton() {
  const activeThreadId = useAgentActiveThreadId();
  const { activeRuns, upsertActiveRun, refreshThreads } = useAgentWorkspace();
  const handleAuthenticationFailure = useAuthenticationFailure();
  const isRunning = useAuiState(({ thread }) => thread.isRunning);
  const [stopping, setStopping] = useState(false);

  const runId = activeRunForThread(activeRuns, activeThreadId)?.id ?? null;
  if (!isRunning && !runId) return null;

  const requestCancel = () => {
    if (!runId || stopping) return;
    setStopping(true);
    void client.agent.runs
      .cancel(runId)
      .then((run) => {
        upsertActiveRun(run);
        void refreshThreads().catch(() => undefined);
      })
      .catch((error) => {
        handleAuthenticationFailure(error);
        setStopping(false);
      });
  };

  const className = cn(
    'grid size-9 shrink-0 place-items-center rounded-full bg-[#151515] text-white transition-[background,transform,opacity] hover:-translate-y-px hover:bg-[#252525] disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none dark:bg-white dark:text-[#151515] dark:hover:bg-[#f0f0f0]',
    'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3',
  );
  const icon = <span aria-hidden="true" className="block size-3 rounded-[0.2rem] bg-current" />;
  const ariaLabel = stopping ? '正在停止运行' : '停止运行';

  if (isRunning) {
    return (
      <ComposerPrimitive.Cancel
        className={className}
        disabled={stopping}
        aria-label={ariaLabel}
        title="停止运行"
        onClick={requestCancel}
      >
        {icon}
      </ComposerPrimitive.Cancel>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={stopping}
      aria-label={ariaLabel}
      title="停止运行"
      onClick={requestCancel}
    >
      {icon}
    </button>
  );
}

interface SandboxToolResult {
  summary?: string;
  status?: string;
  audit?: Record<string, unknown>;
}

type AgentToolUiToolkit = {
  web_fetch: ToolDefinition<
    { url?: string },
    { summary?: string; status?: string; audit?: Record<string, unknown> }
  >;
  shell: ToolDefinition<{ command?: string; workingDirectory?: string }, SandboxToolResult>;
  read_file: ToolDefinition<{ path?: string }, SandboxToolResult>;
  write_file: ToolDefinition<{ path?: string }, SandboxToolResult>;
  export_file: ToolDefinition<{ path?: string }, SandboxToolResult>;
};

function isSandboxToolResult(value: unknown): value is SandboxToolResult {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const agentToolUiToolkit = defineToolkit({
  web_fetch: {
    type: 'backend',
    render: ({ args, result, status, isError }) => {
      const url = typeof args.url === 'string' ? args.url : '';
      const finalUrl =
        typeof result?.audit?.finalUrl === 'string' ? result.audit.finalUrl : undefined;
      const httpStatus = typeof result?.audit?.status === 'number' ? result.audit.status : undefined;

      if (status.type === 'running') return <AgentToolCall url={url} />;

      return (
        <AgentToolResult
          isError={Boolean(isError)}
          status={result?.status ?? (isError ? 'failed' : 'succeeded')}
          httpStatus={httpStatus}
          summary={result?.summary}
          finalUrl={finalUrl}
        />
      );
    },
  },
  shell: {
    type: 'backend',
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
  },
  read_file: {
    type: 'backend',
    render: ({ args, result, status, isError }) => (
      <SandboxToolActivityCard
        toolName="read_file"
        subject={args.path}
        result={result}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
  write_file: {
    type: 'backend',
    render: ({ args, result, status, isError }) => (
      <SandboxToolActivityCard
        toolName="write_file"
        subject={args.path}
        result={result}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
  export_file: {
    type: 'backend',
    render: ({ args, result, status, isError }) => {
      if (status.type === 'running') {
        return (
          <SandboxToolActivityCard
            toolName="export_file"
            subject={args.path}
            running
            isError={false}
          />
        );
      }
      return <ArtifactCard path={args.path} result={result} isError={Boolean(isError)} />;
    },
  },
} satisfies AgentToolUiToolkit);

function ArtifactCard({
  path,
  result,
  isError,
}: {
  path?: string | undefined;
  result?: SandboxToolResult | undefined;
  isError: boolean;
}) {
  const file = parseAgentOutputFileReference(result?.audit);

  if (isError || !file) {
    return (
      <SandboxToolActivityCard
        toolName="export_file"
        subject={path}
        result={result}
        running={false}
        isError
      />
    );
  }
  const previewable = file.mimeType.startsWith('image/');

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
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function SandboxToolActivityCard({
  toolName,
  subject,
  detail,
  result,
  running,
  isError,
}: {
  toolName: 'shell' | 'read_file' | 'write_file' | 'export_file';
  subject?: string | undefined;
  detail?: string | undefined;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}) {
  const state = resolveAgentToolActivityState({
    running,
    status: result?.status,
    isError,
    audit: result?.audit,
  });
  const exitCode = typeof result?.audit?.exitCode === 'number' ? result.audit.exitCode : undefined;
  const size = typeof result?.audit?.size === 'number' ? result.audit.size : undefined;
  const label = toolInvocationLabel(toolName, state);
  const [open, setOpen] = useState(running);

  useEffect(() => {
    setOpen(running);
  }, [running]);

  return (
    <details
      className="group my-2 text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85 open:opacity-75"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center py-1.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn('font-sans font-normal', toolActivityTextClassName(state))}>
            {label}
          </span>
          {exitCode !== undefined ? <span className="font-sans">exit {exitCode}</span> : null}
          {size !== undefined ? <span className="font-sans">{size} B</span> : null}
        </span>
        <AgentDisclosureChevron />
      </summary>
      <div className="mt-1.5 space-y-1 border-l border-current/15 pl-3">
        {subject ? (
          <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all font-sans text-inherit">
            {subject}
          </code>
        ) : null}
        {detail ? <p className="font-sans">{detail}</p> : null}
        <ToolExecutionResult result={result} />
      </div>
    </details>
  );
}

function McpToolActivityCard({
  serverId,
  remoteToolName,
  args,
  result,
  running,
  isError,
}: {
  serverId: string;
  remoteToolName: string;
  args: Record<string, unknown>;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}) {
  const state = resolveAgentToolActivityState({
    running,
    status: result?.status,
    isError,
    audit: result?.audit,
  });
  const label = toolInvocationLabel(`${serverId} · ${remoteToolName}`, state);
  const [open, setOpen] = useState(running);

  useEffect(() => {
    setOpen(running);
  }, [running]);

  return (
    <details
      className="group my-2 text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85 open:opacity-75"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center py-1.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn('font-sans font-normal', toolActivityTextClassName(state))}>
            {label}
          </span>
        </span>
        <AgentDisclosureChevron />
      </summary>
      <div className="mt-1.5 space-y-1 border-l border-current/15 pl-3">
        <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all font-sans text-inherit">
          {JSON.stringify(args)}
        </code>
        <ToolExecutionResult result={result} />
      </div>
    </details>
  );
}

function ToolExecutionResult({ result }: Readonly<{ result?: SandboxToolResult | undefined }>) {
  const summary = result?.summary;
  const audit = result?.audit;
  const hasAudit = audit !== undefined && Object.keys(audit).length > 0;

  if (!summary && !hasAudit) return null;

  return (
    <div className="space-y-1.5 pt-1">
      <p className="font-normal">调用结果</p>
      {summary ? <p>{summary}</p> : null}
      {hasAudit ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-muted px-2.5 py-2 font-sans text-inherit leading-7">
          {JSON.stringify(audit, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function toolInvocationLabel(toolName: string, state: AgentToolActivityState): string {
  if (state === 'running') return `正在调用 ${toolName}`;
  if (state === 'success') return `${toolName} 调用完成`;
  return `${toolName} 调用失败`;
}

function AgentMessageMetadata() {
  const custom = useAuiState(({ message }) => message.metadata.custom) as AgentRunMetadataType;
  return (
    <AgentRunMetadata
      model={custom.model}
      runStatus={custom.runStatus}
function toolActivityTextClassName(state: AgentToolActivityState): string {
  if (state === 'loading' || state === 'running') return 'text-brand';
  if (state === 'success') return 'text-success';
  if (state === 'failed') return 'text-danger';
  if (state === 'limit') return 'text-warning';
  return 'text-ink-subtle';
}

      totalTokens={custom.totalTokens}
      modelCalls={custom.modelCalls}
      toolCalls={custom.toolCalls}
    />
  );
}

function isTextModelAlias(value: string): value is TextModelAlias {
  return ['qwen', 'glm', 'deepseek', 'kimi'].includes(value);
}
