'use client';

import { createSuperMindClient, parseAgentOutputFileReference } from '@supermind/sdk';
import { renderAsync as renderDocx } from 'docx-preview';
import * as XLSX from 'xlsx';
import type {
  AgentContextBudgetState,
  AgentContextSummary,
  AgentMcpServerStatus,
  AgentRunSummary,
  AgentSandboxStatus,
  AgentSkillCandidate,
  AgentStreamEvent,
  AgentThread,
  AgentThreadSandbox,
  AgentUserQuestion,
  ImageGenerationToolResult,
  ImageGenerationSuggestion,
  VideoGenerationToolResult,
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
import {
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CodeXmlIcon,
  DownloadIcon,
  EyeIcon,
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  ImageOffIcon,
  LoaderCircleIcon,
  PlayIcon,
  TerminalSquareIcon,
  VideoIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { AgentSkillSlashPicker } from '@/components/agent-skill-slash-picker';
import { AgentUserQuestionCard } from '@/components/agent-user-question-card';
import ShimmerText from '@/components/shimmer-text';
import { VideoGenerationWaitingCard } from '@/components/video-generation-waiting-card';
import {
  AgentComposerActions,
  AgentComposerModeIndicator,
  ComposerDocumentFiles,
  encodeComposerMessage,
  DocumentUploadButton,
  AgentComposerDock,
  AgentComposerFooter,
  AgentComposerInput,
  AgentComposerRoot,
  AgentComposerSubmitGroup,
  AgentConsolePanel,
  AgentDictationButton,
  AgentDictationTranscript,
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
  AgentThreadNavigator,
  AgentThreadViewport,
  AssistantMessage,
  ModelSelect,
  ThinkingEffortSelect,
  UserMessage,
  AgentWebCreationOption,
  type ComposerDocumentFile,
} from '@/components/chat-thread-ui';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';
import { ProtectedUserPage } from '@/components/protected-user-page';
import { useUserSession } from '@/components/user-session-provider';
import {
  WebsiteArtifactWorkspace,
  useWebsiteArtifactWorkspace,
  type WebsiteArtifactDescriptor,
} from '@/components/website-artifact-workspace';
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
import {
  isCurrentThreadModelSelectionDisabled,
  isCurrentThreadModelUpdatePending,
  shouldUpdateCurrentThreadModel,
  updateThreadModelOptimistically,
} from '@/utils/agent/agent-model-policy';
import {
  AGENT_TOOL_ACTIVITY_LABELS,
  agentToolDetailLabels,
  resolveAgentToolActivityState,
} from '@/utils/agent/agent-tool-activity';
import { resetThreadIfIdle, shouldDetachLocalRun } from '@/utils/agent/agent-thread-hydration';
import {
  foldEventsFromCursor,
  isResumableActiveRun,
  mergeThreadMessagesWithRunView,
} from '@/utils/agent/agent-run-resume';
import { activeRunForThread } from '@/utils/agent/agent-active-runs';
import { resolveWebsiteDeliveryCardState } from '@/utils/agent/website-delivery-state';
import { readWebsiteMode, writeWebsiteMode } from '@/utils/agent/website-mode-state';
import { readImageMode, writeImageMode } from '@/utils/agent/image-mode-state';
import {
  bindDraftVideoModeToThread,
  readVideoMode,
  writeVideoMode,
} from '@/utils/agent/video-mode-state';
import { initialAgentRunViewState } from '@/utils/agent/agent-run-reducer';
import { threadTokenUsagePercentage } from '@/utils/agent/agent-thread-token-usage';
import { logoutUser } from '@/utils/auth/user-auth-client';
import {
  parseNamespacedMcpToolName,
  summarizeAgentMcpStatuses,
} from '@/utils/agent/agent-mcp-status';

const client = createSuperMindClient();

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
  const session = useUserSession();
  const {
    models,
    selectedModel,
    setSelectedModel,
    thinkingEffort,
    setThinkingEffort,
    openThread,
    prependThread,
    refreshThreads,
    updateThreadModel,
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
  const [contextCompressionStatus, setContextCompressionStatus] = useState<
    'idle' | 'compressing' | 'completed'
  >('idle');
  const [skillCandidates, setSkillCandidates] = useState<AgentSkillCandidate[]>([]);
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [skillLoadState, setSkillLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [mcpServers, setMcpServers] = useState<AgentMcpServerStatus[]>([]);
  const [mcpLoadState, setMcpLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [sandboxTelemetry, setSandboxTelemetry] = useState<SandboxTelemetry>({ status: 'idle' });
  const [runProgress, setRunProgress] = useState<AgentRunProgressStage | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AgentUserQuestion | null>(null);
  const [questionActionError, setQuestionActionError] = useState<string | null>(null);
  const [modelUpdatingThreadId, setModelUpdatingThreadId] = useState<string | null>(null);
  const [modelChangeError, setModelChangeError] = useState<{
    threadId: string;
    message: string;
  } | null>(null);
  const [webCreationSelected, setWebCreationSelected] = useState(false);
  const [documentAnalysisSelected, setDocumentAnalysisSelected] = useState(false);
  const [imageGenerationSelected, setImageGenerationSelected] = useState(false);
  const [videoGenerationSelected, setVideoGenerationSelected] = useState(false);
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(false);
  const [composerFiles, setComposerFiles] = useState<ComposerDocumentFile[]>([]);
  const [videoReference, setVideoReference] = useState<{
    id: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [videoReferenceError, setVideoReferenceError] = useState<string | null>(null);
  const [githubLoginPromptOpen, setGithubLoginPromptOpen] = useState(false);
  const [githubLoginSwitching, setGithubLoginSwitching] = useState(false);
  const [githubLoginPromptError, setGithubLoginPromptError] = useState<string | null>(null);

  const skipHydrationRef = useRef(false);
  const localRunThreadIdRef = useRef<string | null>(null);
  const dismissedQuestionIdsRef = useRef(new Set<string>());

  useEffect(() => {
    void client.agent.images
      .models()
      .then((result) => setImageGenerationEnabled(result.enabled && result.models.length > 0))
      .catch(() => setImageGenerationEnabled(false));
  }, []);

  useEffect(
    () => () => {
      if (videoReference?.previewUrl) URL.revokeObjectURL(videoReference.previewUrl);
    },
    [videoReference?.previewUrl],
  );

  useEffect(() => {
    if (!activeThreadId) {
      // 草稿未发送：不恢复选中，切换走 Thread 后回到新建也保持未选。
      setWebCreationSelected(false);
      setDocumentAnalysisSelected(false);
      setImageGenerationSelected(false);
      setVideoGenerationSelected(false);
      writeWebsiteMode(window.localStorage, null, false);
      return;
    }
    setWebCreationSelected(readWebsiteMode(window.localStorage, activeThreadId));
    setImageGenerationSelected(readImageMode(window.localStorage, activeThreadId));
    setVideoGenerationSelected(readVideoMode(window.localStorage, activeThreadId));
  }, [activeThreadId]);

  const updateWebsiteMode = (selected: boolean) => {
    setWebCreationSelected(selected);
    // 仅已有 Thread 持久化；草稿阶段只留在内存，切换 Thread 即丢弃。
    if (activeThreadId) {
      writeWebsiteMode(window.localStorage, activeThreadId, selected);
    }
  };
  const updateImageMode = (selected: boolean) => {
    setImageGenerationSelected(selected);
    if (activeThreadId) writeImageMode(window.localStorage, activeThreadId, selected);
  };
  const updateVideoMode = (selected: boolean) => {
    setVideoGenerationSelected(selected);
    if (activeThreadId) writeVideoMode(window.localStorage, activeThreadId, selected);
  };
  const contextRef = useRef({
    threadId: activeThreadId as string | null,
    model: selectedModel,
    thinkingEffort,
    selectedSkillNames: [] as readonly string[],
    websiteMode: false,
    documentMode: false,
    imageMode: false,
    videoMode: false,
    onRunThreadBound: (() => undefined) as (threadId: string) => void,
    onThreadCreated: (() => undefined) as (thread: Parameters<typeof prependThread>[0]) => void,
    onRunCreated: (() => undefined) as (
      run: Pick<AgentRunSummary, 'id' | 'threadId' | 'model' | 'provider'>,
    ) => void,
    onRunFinished: () => undefined,
    onContextBudget: (() => undefined) as (budget: AgentContextBudgetState) => void,
    onContextCompressed: (() => undefined) as (
      event: Extract<AgentStreamEvent, { type: 'context-compressed' }>,
    ) => void,
    onSandboxStatus: (() => undefined) as (status: AgentSandboxStatus, sandboxId?: string) => void,
    onRunProgressChange: (() => undefined) as (stage: AgentRunProgressStage | null) => void,
    onUserQuestion: (() => undefined) as (question: AgentUserQuestion | null) => void,
  });

  contextRef.current.threadId = activeThreadId;
  contextRef.current.model = selectedModel;
  contextRef.current.thinkingEffort = thinkingEffort;
  contextRef.current.selectedSkillNames = selectedSkillNames;
  contextRef.current.websiteMode = webCreationSelected;
  contextRef.current.documentMode = documentAnalysisSelected;
  contextRef.current.imageMode = imageGenerationSelected;
  contextRef.current.videoMode = videoGenerationSelected;
  contextRef.current.onRunThreadBound = (threadId) => {
    localRunThreadIdRef.current = threadId;
  };
  contextRef.current.onThreadCreated = (thread) => {
    skipHydrationRef.current = true;
    setThreadTokenUsage(null);
    setContextSummary(null);
    setCompressionEvents([]);
    setContextCompressionStatus('idle');
    writeWebsiteMode(window.localStorage, thread.id, webCreationSelected);
    writeImageMode(window.localStorage, thread.id, imageGenerationSelected);
    writeVideoMode(window.localStorage, thread.id, videoGenerationSelected);
    prependThread(thread);
    openThread(thread.id);
  };
  contextRef.current.onRunCreated = (run) => {
    setSandboxTelemetry({ status: 'creating' });
    upsertActiveRun({
      id: run.id,
      threadId: run.threadId,
      model: run.model,
      provider: run.provider,
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
    // LocalRuntime 的终态消息已包含本次 run 的 timing；跳过紧随其后的 hydration，
    // 避免持久化快照（尚不包含前端 timing）覆盖该元数据。
    skipHydrationRef.current = true;
    setRunProgress(null);
    setContextCompressionStatus('idle');
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
    setContextCompressionStatus('completed');
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
  contextRef.current.onContextBudget = (budget) => {
    if (budget.level === 'forced') setContextCompressionStatus('compressing');
  };
  contextRef.current.onSandboxStatus = (status, sandboxId) => {
    setSandboxTelemetry({
      status,
      ...(sandboxId === undefined ? {} : { sandboxId }),
    });
  };
  contextRef.current.onRunProgressChange = setRunProgress;
  contextRef.current.onUserQuestion = (question) => {
    if (question && dismissedQuestionIdsRef.current.has(question.id)) return;
    setQuestionActionError(null);
    setPendingQuestion(question);
  };

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

  const handleModelChange = async (nextModel: TextModelId) => {
    const current = (selectedModel as TextModelId) || modelOptions[0]?.value || 'qwen3.7-plus';
    if (current === nextModel) return;
    if (!shouldUpdateCurrentThreadModel(activeThreadId, current, nextModel)) {
      setSelectedModel(nextModel);
      return;
    }
    const threadId = activeThreadId;
    if (!threadId || isCurrentThreadModelSelectionDisabled(threadId, activeRuns)) return;

    setModelChangeError(null);
    setModelUpdatingThreadId(threadId);
    try {
      await updateThreadModelOptimistically({
        currentModel: current,
        nextModel,
        applySelection: setSelectedModel,
        persist: () => updateThreadModel(threadId, nextModel),
        isStillCurrent: () => contextRef.current.threadId === threadId,
      });
      if (contextRef.current.threadId !== threadId) return;
      try {
        const detail = await client.agent.threads.get(threadId);
        if (contextRef.current.threadId === threadId) {
          setThreadTokenUsage(detail.tokenUsage);
          setContextSummary(detail.contextSummary);
        }
      } catch (cause) {
        handleAuthenticationFailure(cause);
      }
    } catch (cause) {
      handleAuthenticationFailure(cause);
      setModelChangeError({
        threadId,
        message: toModelChangeError(cause),
      });
    } finally {
      setModelUpdatingThreadId((updating) => (updating === threadId ? null : updating));
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
  const dictationAdapter = useMemo(
    () =>
      new WebSpeechDictationAdapter({ language: 'zh-CN', continuous: true, interimResults: true }),
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
  const modelUpdatePending = isCurrentThreadModelUpdatePending(
    activeThreadId,
    modelUpdatingThreadId,
  );
  const modelSelectionDisabled =
    modelDisabled ||
    modelUpdatePending ||
    isCurrentThreadModelSelectionDisabled(activeThreadId, activeRuns);
  const submitBlocked = modelDisabled || currentActiveRun !== null || modelUpdatePending;
  const canCreateWebsite = session.user?.authProvider === 'GITHUB';

  const switchToGithubLogin = async () => {
    if (githubLoginSwitching) return;
    setGithubLoginPromptError(null);
    setGithubLoginSwitching(true);
    try {
      await logoutUser();
      session.clear();
      window.location.assign('/login?returnTo=%2F');
    } catch (error) {
      setGithubLoginPromptError(
        error instanceof Error && error.message ? error.message : '当前账号退出失败，请重试。',
      );
      setGithubLoginSwitching(false);
    }
  };

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <ThreadHydrator
        skipHydrationRef={skipHydrationRef}
        localRunThreadIdRef={localRunThreadIdRef}
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
        onUserQuestion={setPendingQuestion}
      />
      <AgentPageShell>
        <WebsiteArtifactWorkspace scopeKey={activeThreadId ?? 'new-thread'}>
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
              <div className="flex min-h-0 flex-1">
                <AgentThreadNavigator />
                <AgentThreadViewport>
                  <AuiIf condition={(state) => state.thread.isEmpty}>
                    <AgentEmptyState
                      kicker="AGENT THREAD · EMPTY"
                      title="描述你的目标，Agent 来推进"
                    />
                  </AuiIf>
                  <ThreadPrimitive.Messages>
                    {({ message }) =>
                      message.role === 'user' ? (
                        <UserMessage messageId={message.id} threadId={activeThreadId} />
                      ) : (
                        <AssistantMessage
                          runProgress={runProgress}
                          metadata={<AgentMessageMetadata />}
                          renderPart={(part) => {
                            if (part.type === 'tool-call') {
                              if (part.toolUI) return part.toolUI;
                              const toolPart = part as typeof part & {
                                toolName?: unknown;
                                args?: unknown;
                                artifact?: unknown;
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
                                    progress={agentToolProgress(toolPart.artifact)}
                                    result={result}
                                    running={part.status?.type === 'running'}
                                    isError={toolPart.isError === true}
                                  />
                                );
                              }
                              return null;
                            }
                            if (part.type === 'text')
                              return <AssistantMarkdown>{part.text ?? ''}</AssistantMarkdown>;
                            if (part.type === 'reasoning') {
                              return <AgentReasoning text={part.text ?? ''} />;
                            }
                            return null;
                          }}
                        />
                      )
                    }
                  </ThreadPrimitive.Messages>
                  <AgentContextTimeline status={contextCompressionStatus} />
                </AgentThreadViewport>
              </div>
              <AgentComposerDock>
                {pendingQuestion ? null : <AgentScrollToBottom />}
                {pendingQuestion ? (
                  <AgentUserQuestionCard
                    key={pendingQuestion.id}
                    question={pendingQuestion}
                    actionError={questionActionError}
                    onClearActionError={() => setQuestionActionError(null)}
                    onAnswer={async (input) => {
                      const submittedQuestion = pendingQuestion;
                      const submittedThreadId = activeThreadId;
                      dismissedQuestionIdsRef.current.add(submittedQuestion.id);
                      setQuestionActionError(null);
                      setPendingQuestion(null);
                      try {
                        await client.agent.questions.answer(submittedQuestion.id, input);
                      } catch (cause) {
                        dismissedQuestionIdsRef.current.delete(submittedQuestion.id);
                        if (contextRef.current.threadId !== submittedThreadId) return;
                        setQuestionActionError(
                          toQuestionActionError(cause, '回答提交失败，请检查后重试。'),
                        );
                        setPendingQuestion((current) => current ?? submittedQuestion);
                      }
                    }}
                    onSkip={async () => {
                      const skippedQuestion = pendingQuestion;
                      const skippedThreadId = activeThreadId;
                      dismissedQuestionIdsRef.current.add(skippedQuestion.id);
                      setQuestionActionError(null);
                      setPendingQuestion(null);
                      try {
                        await client.agent.questions.skip(skippedQuestion.id);
                      } catch (cause) {
                        dismissedQuestionIdsRef.current.delete(skippedQuestion.id);
                        if (contextRef.current.threadId !== skippedThreadId) return;
                        setQuestionActionError(
                          toQuestionActionError(cause, '暂时无法跳过，请稍后重试。'),
                        );
                        setPendingQuestion((current) => current ?? skippedQuestion);
                      }
                    }}
                  />
                ) : (
                  <>
                    {modelChangeError?.threadId === activeThreadId ? (
                      <p
                        role="alert"
                        className="mx-auto mb-2 w-full max-w-176 rounded-xl border border-danger/25 bg-danger/7 px-3 py-2 text-xs font-medium text-danger sm:w-[calc(100%-2rem)]"
                      >
                        {modelChangeError.message}
                      </p>
                    ) : null}
                    {!webCreationSelected &&
                    !documentAnalysisSelected &&
                    !imageGenerationSelected &&
                    !videoGenerationSelected ? (
                      <div className="mx-auto mb-2 flex w-full max-w-176 gap-2 overflow-x-auto sm:w-[calc(100%-2rem)]">
                        <AgentWebCreationOption
                          selected={webCreationSelected}
                          disabled={submitBlocked}
                          onClick={() => {
                            if (!canCreateWebsite) {
                              setGithubLoginPromptOpen(true);
                              return;
                            }
                            updateWebsiteMode(!webCreationSelected);
                            if (!webCreationSelected) {
                              setDocumentAnalysisSelected(false);
                              updateImageMode(false);
                              updateVideoMode(false);
                            }
                          }}
                        />
                        <AgentWebCreationOption
                          label="文档操作"
                          selected={documentAnalysisSelected}
                          disabled={submitBlocked}
                          onClick={() => {
                            setDocumentAnalysisSelected((current) => !current);
                            if (webCreationSelected) updateWebsiteMode(false);
                            if (!documentAnalysisSelected) updateImageMode(false);
                            if (!documentAnalysisSelected) updateVideoMode(false);
                          }}
                        />
                        {imageGenerationEnabled ? (
                          <AgentWebCreationOption
                            label="图像生成"
                            selected={imageGenerationSelected}
                            disabled={submitBlocked}
                            onClick={() => {
                              updateImageMode(!imageGenerationSelected);
                              if (!imageGenerationSelected) {
                                updateWebsiteMode(false);
                                setDocumentAnalysisSelected(false);
                                updateVideoMode(false);
                              }
                            }}
                          />
                        ) : null}
                        <AgentWebCreationOption
                          label="视频生成"
                          selected={videoGenerationSelected}
                          disabled={submitBlocked}
                          onClick={() => {
                            updateVideoMode(!videoGenerationSelected);
                            if (!videoGenerationSelected) {
                              updateWebsiteMode(false);
                              setDocumentAnalysisSelected(false);
                              updateImageMode(false);
                            }
                          }}
                        />
                      </div>
                    ) : null}
                    <AgentComposerRoot
                      onSubmitText={(prompt) => {
                        if (videoGenerationSelected && videoReference) {
                          setVideoReference(null);
                          return `${prompt}\n\n[当前视频首帧资产ID: ${videoReference.id}]`;
                        }
                        if (composerFiles.length === 0) return prompt;
                        const message = encodeComposerMessage(composerFiles, prompt);
                        setComposerFiles([]);
                        return message;
                      }}
                    >
                      <ComposerDocumentFiles
                        files={composerFiles}
                        onRemove={(index) =>
                          setComposerFiles((current) => current.filter((_, item) => item !== index))
                        }
                      />
                      {videoReference ? (
                        <div
                          className="flex gap-2 overflow-x-auto px-2 pb-2 pt-1"
                          aria-label="视频首帧图"
                        >
                          <div className="group relative h-14 w-10 shrink-0 cursor-pointer shadow-[0_5px_14px_rgb(37_57_103/0.18)]">
                            <img
                              src={videoReference.previewUrl}
                              alt="视频首帧图预览"
                              className="h-14 w-10 object-cover"
                            />
                            <button
                              type="button"
                              aria-label={`移除 ${videoReference.name}`}
                              onClick={() => {
                                const removed = videoReference;
                                setVideoReference(null);
                                if (activeThreadId)
                                  void client.agent.videos.removeReference(
                                    activeThreadId,
                                    removed.id,
                                  );
                              }}
                              className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border border-white/80 bg-black/65 text-white opacity-0 shadow-sm transition-[background-color,opacity] hover:bg-black/80 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                            >
                              <XIcon className="size-3" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      ) : null}
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
                            ? '上一个任务还在进行中，请等待结束后再提交…'
                            : webCreationSelected
                              ? '描述你的网站功能、风格'
                              : documentAnalysisSelected
                                ? '上传文档，对文档进行分析、编辑'
                                : imageGenerationSelected
                                  ? '描述想生成的图片，或继续修改上一张图'
                                  : videoGenerationSelected
                                    ? '描述想生成的视频，可添加一张首帧参考图'
                                    : '有什么问题尽管问，输入/ 调用技能'
                        }
                        disabled={submitBlocked}
                        maxLength={8000}
                      />
                      <AgentDictationTranscript />
                      {videoReferenceError ? (
                        <p role="alert" className="px-3 text-xs text-danger">
                          {videoReferenceError}
                        </p>
                      ) : null}
                      <AgentComposerFooter>
                        <AgentComposerActions>
                          {videoGenerationSelected ? (
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line-soft px-3 py-1.5 text-xs font-medium hover:bg-fill-secondary">
                              <VideoIcon className="size-4" />
                              添加首帧图
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="sr-only"
                                disabled={submitBlocked}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (!file) return;
                                  setVideoReferenceError(null);
                                  void (async () => {
                                    let threadId = activeThreadId;
                                    if (!threadId) {
                                      const created = await client.agent.threads.create({
                                        model:
                                          (selectedModel as TextModelId) ||
                                          modelOptions[0]?.value ||
                                          'qwen3.7-plus',
                                      });
                                      threadId = created.id;
                                      bindDraftVideoModeToThread(
                                        window.localStorage,
                                        threadId,
                                        videoGenerationSelected,
                                      );
                                      prependThread(created);
                                      openThread(threadId);
                                    }
                                    const asset = await client.agent.videos.uploadReference(
                                      threadId,
                                      file,
                                      file.name,
                                    );
                                    const replaced = videoReference;
                                    setVideoReference({
                                      id: asset.id,
                                      name: asset.name,
                                      previewUrl: URL.createObjectURL(file),
                                    });
                                    if (replaced && threadId)
                                      void client.agent.videos.removeReference(
                                        threadId,
                                        replaced.id,
                                      );
                                  })().catch((error: unknown) => {
                                    setVideoReferenceError(
                                      error instanceof Error ? error.message : '首帧图上传失败',
                                    );
                                  });
                                  event.currentTarget.value = '';
                                }}
                              />
                            </label>
                          ) : null}
                          <DocumentUploadButton
                            disabled={submitBlocked}
                            onUpload={async (files) => {
                              let threadId = activeThreadId;
                              if (!threadId) {
                                const created = await client.agent.threads.create({
                                  model:
                                    (selectedModel as TextModelId) ||
                                    modelOptions[0]?.value ||
                                    'qwen3.7-plus',
                                });
                                threadId = created.id;
                                prependThread(created);
                                openThread(threadId);
                              }
                              const uploaded = await client.agent.files.upload(
                                threadId,
                                files,
                                files.map((file) => file.name),
                              );
                              setComposerFiles((current) => [
                                ...current,
                                ...uploaded.files.map((file, index) => ({
                                  name: file.name,
                                  path: file.path,
                                  sizeBytes: files[index]?.size ?? file.sizeBytes,
                                })),
                              ]);
                              await refreshThreads();
                            }}
                          />
                          {webCreationSelected ? (
                            <AgentComposerModeIndicator
                              label="网页开发"
                              disabled={submitBlocked}
                              onClear={() => updateWebsiteMode(false)}
                            />
                          ) : documentAnalysisSelected ? (
                            <AgentComposerModeIndicator
                              label="文档操作"
                              disabled={submitBlocked}
                              onClear={() => setDocumentAnalysisSelected(false)}
                            />
                          ) : imageGenerationSelected ? (
                            <AgentComposerModeIndicator
                              label="图像生成"
                              disabled={submitBlocked}
                              onClear={() => updateImageMode(false)}
                            />
                          ) : videoGenerationSelected ? (
                            <AgentComposerModeIndicator
                              label="视频生成"
                              disabled={submitBlocked}
                              onClear={() => updateVideoMode(false)}
                            />
                          ) : null}
                        </AgentComposerActions>
                        <AgentComposerSubmitGroup>
                          <ThinkingEffortSelect
                            value={thinkingEffort}
                            disabled={modelDisabled}
                            onChange={setThinkingEffort}
                          />
                          <ModelSelect
                            value={
                              (selectedModel as TextModelId) ||
                              modelOptions[0]?.value ||
                              'qwen3.7-plus'
                            }
                            options={modelOptions}
                            disabled={modelSelectionDisabled}
                            boundHint={activeThreadId !== null}
                            menuTitle={activeThreadId ? '切换当前会话模型' : '运行模型'}
                            onChange={(model) => void handleModelChange(model)}
                          />
                          {dictationSupported ? (
                            <AgentDictationButton disabled={submitBlocked} />
                          ) : null}
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
                  </>
                )}
              </AgentComposerDock>
            </AgentThreadRoot>
          </AgentConsolePanel>
        </WebsiteArtifactWorkspace>
      </AgentPageShell>
      {githubLoginPromptOpen
        ? createPortal(
            <div
              role="presentation"
              className="fixed inset-0 z-100 grid place-items-center bg-black/25 p-4 backdrop-blur-sm"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setGithubLoginPromptOpen(false);
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="github-login-prompt-title"
                className="w-full max-w-sm rounded-2xl border border-line bg-surface-card p-5 shadow-[0_20px_50px_rgb(0_0_0/0.18)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-brand">网页创作</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGithubLoginPromptOpen(false)}
                    aria-label="关闭提示"
                    className="grid size-8 place-items-center rounded-full text-lg text-ink-muted transition hover:bg-surface-inset hover:text-ink"
                  >
                    ×
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink-muted">
                  当前账号类型不支持网页创作。
                </p>
                {githubLoginPromptError ? (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {githubLoginPromptError}
                  </p>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setGithubLoginPromptOpen(false)}
                    disabled={githubLoginSwitching}
                    className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted transition hover:bg-surface-inset"
                  >
                    暂不登录
                  </button>
                  <button
                    type="button"
                    onClick={() => void switchToGithubLogin()}
                    disabled={githubLoginSwitching}
                    className="rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-65"
                  >
                    {githubLoginSwitching ? '正在切换账号…' : '使用 GitHub 登录'}
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
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
        'liquid-glass absolute top-4 right-4 z-30 overflow-hidden border-line/80 shadow-[0_24px_70px_rgb(41_54_88/0.18)] transition-[width,border-radius] duration-200 motion-reduce:transition-none',
        isCollapsed ? 'w-44 rounded-2xl' : 'w-88 rounded-[1.35rem] p-2',
      )}
    >
      {isCollapsed ? (
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-surface-card/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
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

          <div className="overflow-hidden rounded-2xl border border-line/75 bg-surface-card/70">
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

function toQuestionActionError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function toModelChangeError(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : '模型切换失败，当前会话仍使用原模型。';
}

function ThreadHydrator({
  skipHydrationRef,
  localRunThreadIdRef,
  onTokenUsage,
  onContextSummary,
  onCompressionEvent,
  onResetCompressionEvents,
  onSandboxStatus,
  onSandboxSnapshot,
  onUserQuestion,
}: {
  skipHydrationRef: { current: boolean };
  localRunThreadIdRef: { current: string | null };
  onTokenUsage: (usage: AgentThread['tokenUsage'] | null) => void;
  onContextSummary: (summary: AgentContextSummary | null) => void;
  onCompressionEvent: (event: Extract<AgentStreamEvent, { type: 'context-compressed' }>) => void;
  onResetCompressionEvents: () => void;
  onSandboxStatus: (status: AgentSandboxStatus, sandboxId?: string) => void;
  onSandboxSnapshot: (sandbox: AgentThreadSandbox | null) => void;
  onUserQuestion: (question: AgentUserQuestion | null) => void;
}) {
  const api = useAui();
  const isLocalRunRunning = useAuiState(({ thread }) => thread.isRunning);
  const activeThreadId = useAgentActiveThreadId();
  const { setSelectedModel, upsertActiveRun, removeActiveRun, refreshThreads } =
    useAgentWorkspace();
  const handleAuthenticationFailure = useAuthenticationFailure();

  const [interruptedNotice, setInterruptedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldDetachLocalRun(isLocalRunRunning, localRunThreadIdRef.current, activeThreadId)) {
      return;
    }
    skipHydrationRef.current = false;
    api.thread().cancelRun();
  }, [activeThreadId, isLocalRunRunning]);

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
    onUserQuestion(null);

    void (async () => {
      try {
        if (!activeThreadId) {
          resetThreadIfIdle(api.thread(), []);
          setInterruptedNotice(null);
          onTokenUsage(null);
          onContextSummary(null);
          onResetCompressionEvents();
          onSandboxSnapshot(null);
          onUserQuestion(null);
          return;
        }
        const thread = await client.agent.threads.get(activeThreadId);
        if (cancelled) return;
        setSelectedModel(thread.model);
        onContextSummary(thread.contextSummary);
        onTokenUsage(thread.tokenUsage);
        onResetCompressionEvents();
        onUserQuestion(thread.pendingQuestion);

        if (isResumableActiveRun(thread.activeRun)) {
          onSandboxStatus('creating');
          upsertActiveRun(thread.activeRun);
          setInterruptedNotice(null);
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
            if (event.type === 'user-question-asked') onUserQuestion(event.question);
            if (event.type === 'user-question-answered' || event.type === 'user-question-skipped') {
              onUserQuestion(null);
            }
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
              onUserQuestion(null);
              removeActiveRun(activeThreadId);
              void refreshThreads().catch(() => undefined);
              return;
            }
          }
          return;
        }

        const interrupted = thread.lastRun?.status === 'interrupted';
        onUserQuestion(null);
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
  return null;
}

function AgentContextTimeline({ status }: { status: 'idle' | 'compressing' | 'completed' }) {
  if (status === 'idle') return null;
  return (
    <div
      className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3 text-xs text-ink-muted"
      aria-live="polite"
      aria-label="上下文压缩状态"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
      <span>{status === 'compressing' ? '正在压缩上下文…' : '上下文压缩完成'}</span>
    </div>
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
  create_website: ToolDefinition<Record<string, never>, SandboxToolResult>;
  generate_image: ToolDefinition<Record<string, unknown>, SandboxToolResult>;
  generate_video: ToolDefinition<Record<string, unknown>, SandboxToolResult>;
};

function isSandboxToolResult(value: unknown): value is SandboxToolResult {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function agentToolProgress(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.content !== 'string') return undefined;
  return value.content;
}

const agentToolUiToolkit = defineToolkit({
  web_fetch: {
    type: 'backend',
    render: ({ args, artifact, result, status, isError }) => {
      const url = typeof args.url === 'string' ? args.url : '';
      const finalUrl =
        typeof result?.audit?.finalUrl === 'string' ? result.audit.finalUrl : undefined;
      const httpStatus =
        typeof result?.audit?.status === 'number' ? result.audit.status : undefined;

      return (
        <ToolActivityCard
          toolName="web_fetch"
          subject={finalUrl ?? url}
          detail={httpStatus === undefined ? undefined : `HTTP ${httpStatus}`}
          args={url ? { url } : undefined}
          progress={agentToolProgress(artifact)}
          result={result}
          running={status.type === 'running'}
          isError={Boolean(isError)}
        />
      );
    },
  },
  shell: {
    type: 'backend',
    render: ({ args, artifact, result, status, isError }) => (
      <SandboxToolActivityCard
        toolName="shell"
        subject={args.command}
        detail={args.workingDirectory}
        progress={agentToolProgress(artifact)}
        result={result}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
  read_file: {
    type: 'backend',
    render: ({ args, artifact, result, status, isError }) => (
      <SandboxToolActivityCard
        toolName="read_file"
        subject={args.path}
        progress={agentToolProgress(artifact)}
        result={result}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
  write_file: {
    type: 'backend',
    render: ({ args, artifact, result, status, isError }) => (
      <SandboxToolActivityCard
        toolName="write_file"
        subject={args.path}
        progress={agentToolProgress(artifact)}
        result={result}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
  export_file: {
    type: 'backend',
    render: ({ args, artifact, result, status, isError }) => {
      if (status.type === 'running') {
        return (
          <SandboxToolActivityCard
            toolName="export_file"
            subject={args.path}
            progress={agentToolProgress(artifact)}
            running
            isError={false}
          />
        );
      }
      return <ArtifactCard path={args.path} result={result} isError={Boolean(isError)} />;
    },
  },
  create_website: {
    type: 'backend',
    render: ({ artifact, result, status, isError }) => {
      if (status.type === 'running') {
        return (
          <SandboxToolActivityCard
            toolName="create_website"
            subject="构建、校验并覆盖最终网站产物"
            progress={agentToolProgress(artifact)}
            running
            isError={false}
          />
        );
      }
      return <WebsiteDeliveryCard result={result} isError={Boolean(isError)} />;
    },
  },
  generate_image: {
    type: 'backend',
    render: ({ artifact, result, status, isError }) => (
      <ImageGenerationCard
        {...(agentToolProgress(artifact) === undefined
          ? {}
          : { progress: agentToolProgress(artifact) })}
        {...(result === undefined ? {} : { result })}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
  generate_video: {
    type: 'backend',
    render: ({ artifact, result, status, isError }) => (
      <VideoGenerationCard
        {...(agentToolProgress(artifact) === undefined
          ? {}
          : { progress: agentToolProgress(artifact) })}
        {...(result === undefined ? {} : { result })}
        running={status.type === 'running'}
        isError={Boolean(isError)}
      />
    ),
  },
} satisfies AgentToolUiToolkit);

function VideoGenerationCard({
  progress,
  result,
  running,
  isError,
}: Readonly<{
  progress?: string | undefined;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}>) {
  const aui = useAui();
  const threadRunning = useAuiState(({ thread }) => thread.isRunning);
  const projected = isRecord(result?.audit?.videoGeneration)
    ? (result.audit.videoGeneration as unknown as VideoGenerationToolResult)
    : null;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(projected?.saved ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const status = projected?.status ?? (running ? 'running' : isError ? 'failed' : 'pending');
  if (running || ['pending', 'submitting', 'running', 'persisting'].includes(status)) {
    return <VideoGenerationWaitingCard />;
  }
  if (!projected || projected.status !== 'succeeded' || !projected.videoId)
    return (
      <ToolActivityCard
        toolName="generate_video"
        progress={progress ?? videoStatusLabel(status)}
        result={result}
        running={running}
        isError={isError || ['failed', 'cancelled', 'timed_out', 'expired'].includes(status)}
      />
    );
  return (
    <div className="space-y-3">
      <article className="group relative w-full max-w-[20rem] overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_24%_20%,rgb(255_255_255/0.9),transparent_36%),linear-gradient(135deg,rgb(232_237_246),rgb(218_226_239))] shadow-sm dark:bg-[radial-gradient(circle_at_24%_20%,rgb(255_255_255/0.08),transparent_36%),linear-gradient(135deg,rgb(36_42_54),rgb(24_29_39))]">
        <video
          ref={inlineVideoRef}
          src={projected.previewUrl ?? ''}
          playsInline
          preload="metadata"
          className="aspect-video w-full object-cover"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        {!playing ? (
          <button
            type="button"
            aria-label="播放视频"
            className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/45 bg-black/45 text-white shadow-xl backdrop-blur-md transition-transform hover:scale-105 focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-2"
            onClick={() => void inlineVideoRef.current?.play()}
          >
            <PlayIcon aria-hidden="true" className="ml-0.5 size-5 fill-current" />
          </button>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 via-black/35 to-transparent px-2.5 pt-8 pb-2 text-white">
          <div className="flex h-8 items-center gap-0.5">
            <span className="shrink-0 text-[10px] font-medium tabular-nums">
              {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
            </span>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              aria-label="预览视频"
              title="预览"
              className="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
              onClick={() => setPreviewOpen(true)}
            >
              <EyeIcon aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              disabled={saving || saved}
              aria-label={saved ? '视频已保存' : saving ? '正在保存视频' : '保存视频'}
              title={saved ? '已保存' : saving ? '保存中…' : '保存'}
              className="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-65"
              onClick={() => {
                setSaving(true);
                setSaveError(null);
                void client.agent.videos
                  .save(projected.videoId!)
                  .then(() => setSaved(true))
                  .catch((error: unknown) =>
                    setSaveError(error instanceof Error ? error.message : '保存失败'),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              <CheckIcon aria-hidden="true" className="size-4" />
            </button>
            <a
              href={projected.downloadUrl ?? '#'}
              download
              aria-label="下载视频"
              title="下载"
              className="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
            >
              <DownloadIcon aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
        {saveError ? (
          <p
            role="alert"
            className="absolute inset-x-3 top-3 rounded-lg bg-danger px-3 py-2 text-xs font-medium text-white shadow-lg"
          >
            {saveError}
          </p>
        ) : null}
      </article>
      {projected.modelSwitched ? (
        <p className="text-xs text-ink-muted">已为你切换到支持当前要求的视频模型</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {projected.suggestions.map((suggestion) => (
          <button
            key={suggestion.prompt}
            type="button"
            disabled={threadRunning}
            className="rounded-full border border-line-soft bg-surface px-3 py-1.5 text-xs font-medium hover:bg-brand-subtle disabled:opacity-45"
            onClick={() =>
              void aui
                .thread()
                .append({ role: 'user', content: [{ type: 'text', text: suggestion.prompt }] })
            }
          >
            {suggestion.label}
          </button>
        ))}
      </div>
      {previewOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
              onClick={() => setPreviewOpen(false)}
            >
              <div className="w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
                <video
                  src={projected.previewUrl ?? ''}
                  controls
                  autoPlay
                  className="max-h-[80vh] w-full rounded-xl bg-black"
                />
                <button
                  type="button"
                  className="mt-3 rounded-full bg-white px-4 py-2 text-sm text-black"
                  onClick={() => setPreviewOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function videoStatusLabel(status: string) {
  return (
    (
      {
        pending: '准备中',
        submitting: '正在提交',
        running: '正在生成视频',
        persisting: '正在保存到沙箱',
        failed: '视频生成失败',
        timed_out: '视频生成超时',
        cancelled: '已停止',
        expired: '临时视频已过期',
      } as Record<string, string>
    )[status] ?? '处理中'
  );
}

function ImageGenerationCard({
  progress,
  result,
  running,
  isError,
}: Readonly<{
  progress?: string | undefined;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}>) {
  const aui = useAui();
  const threadRunning = useAuiState(({ thread }) => thread.isRunning);
  const projected = isRecord(result?.audit?.imageGeneration)
    ? (result.audit.imageGeneration as unknown as ImageGenerationToolResult)
    : null;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(projected?.saved ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const status = projected?.status ?? (running ? 'running' : isError ? 'failed' : 'pending');
  const suggestions = projected ? imageGenerationSuggestions(projected) : [];

  if (!projected || projected.status !== 'succeeded' || !projected.imageId) {
    return (
      <ToolActivityCard
        toolName="generate_image"
        detail={projected?.modelName}
        progress={progress ?? imageStatusLabel(status)}
        result={result}
        running={running}
        isError={
          isError || ['failed', 'cancelled', 'expired', 'submission_unknown'].includes(status)
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <article className="group relative aspect-video w-full max-w-[20rem] overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_24%_20%,rgb(255_255_255/0.9),transparent_36%),linear-gradient(135deg,rgb(232_237_246),rgb(218_226_239))] shadow-sm dark:bg-[radial-gradient(circle_at_24%_20%,rgb(255_255_255/0.08),transparent_36%),linear-gradient(135deg,rgb(36_42_54),rgb(24_29_39))]">
        {imageFailed ? (
          <div
            className="flex aspect-video w-full flex-col items-center justify-center gap-3 text-ink-muted"
            role="img"
            aria-label="图片暂时无法加载"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-white/55 shadow-sm backdrop-blur-sm dark:bg-white/8">
              <ImageOffIcon aria-hidden="true" className="size-6" />
            </span>
            <span className="text-xs font-medium">图片暂时无法加载</span>
          </div>
        ) : (
          <img
            src={projected.previewUrl ?? ''}
            alt={projected.effectivePrompt}
            className="aspect-video w-full object-contain"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-black/35 via-black/10 to-transparent px-3 pb-4 pt-14 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/55 p-1 text-white shadow-lg backdrop-blur-md">
            <a
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1"
              href={projected.downloadUrl ?? '#'}
              download
              aria-label="下载图片"
              title="下载图片"
            >
              <DownloadIcon aria-hidden="true" className="size-4" />
              下载
            </a>
            <span aria-hidden="true" className="h-4 w-px bg-white/25" />
            <button
              type="button"
              disabled={saving || saved}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1 disabled:cursor-default disabled:opacity-65"
              onClick={() => {
                setSaving(true);
                setSaveError(null);
                void client.agent.images
                  .save(projected.imageId!)
                  .then(() => setSaved(true))
                  .catch((error: unknown) =>
                    setSaveError(error instanceof Error ? error.message : '保存失败'),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              <CheckIcon aria-hidden="true" className="size-4" />
              {saved ? '已保存' : saving ? '保存中…' : '保存'}
            </button>
            <span aria-hidden="true" className="h-4 w-px bg-white/25" />
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1"
              aria-label="基于此图继续修改"
              title="基于此图继续修改"
              onClick={() => {
                aui.thread().composer().setText(`请基于图片 ${projected.imageId} 继续修改：`);
                requestAnimationFrame(() =>
                  document.querySelector<HTMLTextAreaElement>('textarea')?.focus(),
                );
              }}
            >
              <FilePenLineIcon aria-hidden="true" className="size-4" />
              修改
            </button>
          </div>
        </div>
        {saveError ? (
          <p
            role="alert"
            className="absolute inset-x-3 top-3 rounded-lg bg-danger px-3 py-2 text-xs font-medium text-white shadow-lg"
          >
            {saveError}
          </p>
        ) : null}
      </article>
      <div className="space-y-2" aria-label="继续修改图片">
        {(['aspectRatio', 'quality', 'model'] as const).map((kind) => {
          const items = suggestions.filter((item) => item.kind === kind);
          if (items.length === 0) return null;
          const title =
            kind === 'aspectRatio' ? '修改尺寸' : kind === 'quality' ? '修改质量' : '替换模型';
          return (
            <div key={kind} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-xs text-ink-muted">{title}</span>
              {items.map((suggestion) => (
                <button
                  key={`${suggestion.kind}:${suggestion.value}`}
                  type="button"
                  disabled={threadRunning}
                  className="rounded-full border border-line-soft bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand/35 hover:bg-brand-subtle hover:text-brand-hover focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => {
                    void aui.thread().append({
                      role: 'user',
                      content: [{ type: 'text', text: suggestion.prompt }],
                    });
                  }}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function imageGenerationSuggestions(
  result: ImageGenerationToolResult,
): ImageGenerationSuggestion[] {
  if (result.suggestions?.length) return result.suggestions;
  const legacyCapabilities = {
    'qwen-image': { aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'], qualities: ['1K', '2K'] },
    'wan-image': {
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      qualities: ['1K', '2K', '4K'],
    },
    'kling-image': { aspectRatios: ['1:1', '16:9', '9:16'], qualities: ['1K', '2K'] },
    'vidu-image': {
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      qualities: ['1K', '2K'],
    },
  } as const;
  const capability = legacyCapabilities[result.model];
  return [
    ...capability.aspectRatios
      .filter((value) => value !== result.settings.aspectRatio)
      .map((value) => ({
        kind: 'aspectRatio' as const,
        value,
        label: `改为 ${value}`,
        prompt: `请基于上一张图片继续修改，保持画面内容和风格不变，将图片比例调整为 ${value}。`,
      })),
    ...capability.qualities
      .filter((value) => value !== result.settings.quality)
      .map((value) => ({
        kind: 'quality' as const,
        value,
        label: `改为 ${value}`,
        prompt: `请基于上一张图片继续修改，保持画面内容和风格不变，将图片质量调整为 ${value}。`,
      })),
    ...result.alternatives.map((alternative) => ({
      kind: 'model' as const,
      value: alternative.id,
      label: alternative.name,
      prompt: `请使用 ${alternative.id} 模型，基于上一张图片继续创作，保持画面内容和风格不变。`,
    })),
  ];
}

function imageStatusLabel(status: string): string {
  return (
    (
      {
        pending: '排队中',
        submitting: '正在提交',
        running: '正在生成',
        persisting: '正在保存到临时空间',
        failed: '生成失败',
        cancel_requested: '正在停止',
        cancelled: '已停止，可能仍产生费用',
        expired: '临时空间已过期',
        submission_unknown: '提交状态未知，请勿重试',
      } as Record<string, string>
    )[status] ?? status
  );
}

function WebsiteDeliveryCard({
  result,
  isError,
}: Readonly<{ result?: SandboxToolResult | undefined; isError: boolean }>) {
  const { openArtifact } = useWebsiteArtifactWorkspace();
  const projectId =
    typeof result?.audit?.projectId === 'string' ? result.audit.projectId : undefined;
  const runId = typeof result?.audit?.runId === 'string' ? result.audit.runId : undefined;
  const previewUrl =
    typeof result?.audit?.previewPath === 'string' ? result.audit.previewPath : undefined;
  const sourceUrl =
    typeof result?.audit?.sourceDownloadUrl === 'string'
      ? result.audit.sourceDownloadUrl
      : undefined;
  const distUrl =
    typeof result?.audit?.distDownloadUrl === 'string' ? result.audit.distDownloadUrl : undefined;
  const builtAt = typeof result?.audit?.builtAt === 'string' ? result.audit.builtAt : undefined;
  const [deliveryState, setDeliveryState] = useState<
    'checking' | 'current' | 'superseded' | 'unavailable'
  >('checking');
  const artifact = useMemo<WebsiteArtifactDescriptor | null>(
    () =>
      projectId && runId && previewUrl && sourceUrl && distUrl
        ? {
            id: `${projectId}:${runId}`,
            previewUrl,
            sourceUrl,
            distUrl,
            ...(builtAt ? { builtAt } : {}),
          }
        : null,
    [builtAt, distUrl, previewUrl, projectId, runId, sourceUrl],
  );

  useEffect(() => {
    if (!projectId || !runId || isError) {
      setDeliveryState('superseded');
      return;
    }
    const controller = new AbortController();
    void client.creations
      .list({ signal: controller.signal })
      .then((items) => {
        setDeliveryState(resolveWebsiteDeliveryCardState(items, projectId, runId));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('确认最新网站产物失败', error);
          setDeliveryState('unavailable');
        }
      });
    return () => controller.abort();
  }, [isError, projectId, runId]);

  const current = deliveryState === 'current';

  if (isError || !previewUrl || !sourceUrl || !distUrl) {
    return (
      <SandboxToolActivityCard toolName="create_website" result={result} running={false} isError />
    );
  }

  return (
    <button
      type="button"
      disabled={!current || !artifact}
      onClick={() => {
        if (artifact) openArtifact(artifact);
      }}
      className={cn(
        'group my-3 flex w-full max-w-120 items-stretch gap-4 rounded-[1.6rem] border border-line bg-surface-card p-4 text-left shadow-[0_10px_30px_rgb(37_57_103/0.07)] transition',
        current &&
          'cursor-pointer hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-[0_16px_38px_rgb(37_57_103/0.12)] focus-visible:outline-3 focus-visible:outline-brand-focus',
        !current && 'cursor-not-allowed opacity-70',
      )}
      aria-label={current ? '打开网页开发产物' : undefined}
    >
      <span
        aria-hidden="true"
        className="relative grid size-[5.6rem] shrink-0 place-items-center overflow-hidden rounded-[1.15rem] bg-[linear-gradient(145deg,#eef0f8,#fafbff)]"
      >
        <span className="absolute top-3 left-3 h-1.5 w-12 rounded-full bg-[#d6d8e4]" />
        <span className="absolute top-6 left-3 h-1.5 w-8 rounded-full bg-[#dfe1ea]" />
        <span className="absolute right-3 bottom-3 left-3 h-10 rounded-lg border border-[#e4e6ef] bg-white">
          <span className="absolute top-2 left-2 size-1 rounded-full bg-[#ff908a]" />
          <span className="absolute top-2 left-4 size-1 rounded-full bg-[#ffd06f]" />
          <span className="absolute top-2 left-6 size-1 rounded-full bg-[#76d89a]" />
          <span className="absolute right-2 bottom-2 left-2 h-4 rounded bg-[#f0f1f7]" />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="text-base font-semibold text-ink">网页开发</span>
        <span className="mt-1 text-xs text-ink-muted">
          {deliveryState === 'checking'
            ? '正在确认最新产物…'
            : deliveryState === 'unavailable'
              ? '暂时无法确认产物状态'
              : deliveryState === 'superseded'
                ? '已被后续修改覆盖'
                : '预览、查看代码或下载'}
        </span>
        <span className="mt-auto flex items-end justify-between gap-3 pt-4">
          <time className="text-xs tabular-nums text-ink-muted" dateTime={builtAt}>
            {formatWebsiteBuiltAt(builtAt)}
          </time>
          <EyeIcon
            aria-hidden="true"
            className={cn('size-5 text-ink-muted transition', current && 'group-hover:text-brand')}
          />
        </span>
      </span>
    </button>
  );
}

function formatWebsiteBuiltAt(value: string | undefined): string {
  if (!value) return '刚刚完成';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '刚刚完成';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

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
  const documentPreview =
    file.mimeType === 'application/pdf' ||
    file.name.endsWith('.docx') ||
    file.name.endsWith('.xlsx');

  return (
    <figure className="my-3 overflow-hidden rounded-2xl border border-line bg-surface-card shadow-[0_14px_38px_rgb(37_57_103/0.09)]">
      {previewable ? (
        // 预览地址是经过 owner 校验、CSP sandbox 与 nosniff 保护的同源文件接口。
        <img
          src={file.contentUrl}
          alt={file.name}
          className="max-h-112 w-full bg-white object-contain"
        />
      ) : documentPreview ? (
        <DocumentPreview file={file} />
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

function DocumentPreview({
  file,
}: {
  file: NonNullable<ReturnType<typeof parseAgentOutputFileReference>>;
}) {
  const [state, setState] = useState<{ kind: 'loading' | 'error' | 'ready'; content?: string }>({
    kind: 'loading',
  });
  const docxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(file.contentUrl)
      .then((response) => {
        if (!response.ok) throw new Error('文件已过期或不可用');
        return response.arrayBuffer();
      })
      .then(async (bytes) => {
        if (cancelled) return;
        if (file.mimeType === 'application/pdf') {
          setState({ kind: 'ready' });
        } else if (file.name.endsWith('.docx') && docxRef.current) {
          await renderDocx(bytes, docxRef.current);
          setState({ kind: 'ready' });
        } else {
          const workbook = XLSX.read(bytes, { type: 'array', cellFormula: true });
          const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
          setState({
            kind: 'ready',
            content: sheet
              ? JSON.stringify(XLSX.utils.sheet_to_json(sheet, { header: 1 }))
              : '空工作簿',
          });
        }
      })
      .catch(
        (error: unknown) =>
          !cancelled &&
          setState({ kind: 'error', content: error instanceof Error ? error.message : '预览失败' }),
      );
    return () => {
      cancelled = true;
    };
  }, [file.contentUrl, file.mimeType, file.name]);
  if (state.kind === 'error')
    return (
      <div className="m-3 rounded-xl bg-fill-secondary p-3 text-xs text-ink-muted">
        {state.content}
      </div>
    );
  if (file.mimeType === 'application/pdf')
    return <iframe title={file.name} src={file.contentUrl} className="h-112 w-full border-0" />;
  if (file.name.endsWith('.docx'))
    return <div ref={docxRef} className="max-h-112 overflow-auto bg-white p-3 text-black" />;
  return (
    <pre className="max-h-112 overflow-auto bg-white p-3 text-xs text-black">
      {state.kind === 'loading' ? '正在生成预览…' : state.content}
    </pre>
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
  progress,
  result,
  running,
  isError,
}: {
  toolName: 'shell' | 'read_file' | 'write_file' | 'export_file' | 'create_website';
  subject?: string | undefined;
  detail?: string | undefined;
  progress?: string | undefined;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}) {
  return (
    <ToolActivityCard
      toolName={toolName}
      subject={subject}
      detail={detail}
      progress={progress}
      result={result}
      running={running}
      isError={isError}
    />
  );
}

function McpToolActivityCard({
  serverId,
  remoteToolName,
  args,
  progress,
  result,
  running,
  isError,
}: {
  serverId: string;
  remoteToolName: string;
  args: Record<string, unknown>;
  progress?: string | undefined;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}) {
  return (
    <div data-mcp-server-id={serverId}>
      <ToolActivityCard
        toolName={remoteToolName}
        subject={serverId}
        args={args}
        progress={progress}
        result={result}
        running={running}
        isError={isError}
      />
    </div>
  );
}

function ToolActivityCard({
  toolName,
  subject,
  detail,
  args,
  progress,
  result,
  running,
  isError,
}: {
  toolName: string;
  subject?: string | undefined;
  detail?: string | undefined;
  args?: Record<string, unknown> | undefined;
  progress?: string | undefined;
  result?: SandboxToolResult | undefined;
  running: boolean;
  isError: boolean;
}) {
  const activityState = resolveAgentToolActivityState({
    running,
    status: result?.status,
    isError,
    audit: result?.audit,
  });
  const statusLabel = AGENT_TOOL_ACTIVITY_LABELS[activityState];
  const hasDetails = Boolean(subject || detail || args || progress || result);
  const detailLabels = agentToolDetailLabels(toolName);

  return (
    <details
      role="region"
      aria-label={`${toolCallLabel(toolName)}：${statusLabel}`}
      aria-busy={running}
      className="group/details my-2 min-w-0 overflow-hidden rounded-xl border border-line/85 bg-surface-card/75 text-[0.84rem] leading-5 text-ink shadow-[0_4px_14px_rgb(37_57_103/0.04)]"
    >
      <summary
        className={cn(
          'flex min-w-0 list-none items-center gap-2.5 px-3 py-2.5 transition [&::-webkit-details-marker]:hidden',
          hasDetails &&
            'cursor-pointer hover:bg-surface-muted/45 focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-[-3px]',
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink-muted">
          <ToolIcon toolName={toolName} />
        </span>
        <span className="shrink-0 font-medium">{toolCallLabel(toolName)}</span>
        <ToolStatus state={activityState} label={statusLabel} />
        {subject ? (
          <code
            className="min-w-0 flex-1 truncate text-right font-mono text-[0.76rem] text-ink-muted"
            title={subject}
          >
            {subject}
          </code>
        ) : null}
        {hasDetails ? (
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-ink-subtle transition-transform group-open/details:rotate-90"
          />
        ) : null}
      </summary>
      {hasDetails ? (
        <div className="min-w-0 space-y-3 border-t border-line/60 bg-surface-inset/45 px-3 py-3">
          {subject ? <ToolDetail label={detailLabels.subject} value={subject} code /> : null}
          {detail ? <ToolDetail label={detailLabels.detail} value={detail} /> : null}
          {args ? <ToolDetail label="参数" value={JSON.stringify(args, null, 2)} code /> : null}
          {progress ? <ToolDetail label="进度" value={progress} /> : null}
          <ToolExecutionResult result={result} labels={detailLabels} />
        </div>
      ) : null}
    </details>
  );
}

function ToolStatus({
  state,
  label,
}: Readonly<{
  state: ReturnType<typeof resolveAgentToolActivityState>;
  label: string;
}>) {
  const className = cn(
    'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.68rem] font-medium',
    state === 'success' && 'bg-success/10 text-success',
    (state === 'failed' || state === 'limit') && 'bg-danger/10 text-danger',
    state === 'cancelled' && 'bg-surface-muted text-ink-muted',
    (state === 'loading' || state === 'running') && 'bg-brand-subtle text-brand',
  );
  const iconClassName = 'size-3';

  return (
    <span className={className} role={state === 'running' ? 'status' : undefined}>
      {state === 'running' || state === 'loading' ? (
        <LoaderCircleIcon aria-hidden="true" className={cn(iconClassName, 'animate-spin')} />
      ) : state === 'success' ? (
        <CheckIcon aria-hidden="true" className={iconClassName} />
      ) : state === 'cancelled' ? (
        <BanIcon aria-hidden="true" className={iconClassName} />
      ) : state === 'limit' ? (
        <CircleAlertIcon aria-hidden="true" className={iconClassName} />
      ) : (
        <XIcon aria-hidden="true" className={iconClassName} />
      )}
      {state === 'running' ? <ShimmerText>{label}</ShimmerText> : label}
    </span>
  );
}

function ToolIcon({ toolName }: Readonly<{ toolName: string }>) {
  const className = 'size-3.5';
  if (toolName === 'shell') return <TerminalSquareIcon aria-hidden="true" className={className} />;
  if (toolName === 'read_file') return <FileTextIcon aria-hidden="true" className={className} />;
  if (toolName === 'write_file')
    return <FilePenLineIcon aria-hidden="true" className={className} />;
  if (toolName === 'export_file') return <DownloadIcon aria-hidden="true" className={className} />;
  if (toolName === 'create_website')
    return <CodeXmlIcon aria-hidden="true" className={className} />;
  if (toolName === 'web_fetch') return <GlobeIcon aria-hidden="true" className={className} />;
  return <WrenchIcon aria-hidden="true" className={className} />;
}

function ToolDetail({
  label,
  value,
  code = false,
}: Readonly<{ label: string; value: string; code?: boolean }>) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-subtle">
        {label}
      </p>
      {code ? (
        <pre className="max-h-56 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line/70 bg-surface-card px-2.5 py-2 font-mono text-[0.73rem] leading-5 text-ink">
          {value}
        </pre>
      ) : (
        <p className="wrap-break-word text-[0.78rem] text-ink-muted">{value}</p>
      )}
    </div>
  );
}

function ToolExecutionResult({
  result,
  labels,
}: Readonly<{
  result?: SandboxToolResult | undefined;
  labels: ReturnType<typeof agentToolDetailLabels>;
}>) {
  const summary = result?.summary;
  const audit = result?.audit;
  const hasAudit = audit !== undefined && Object.keys(audit).length > 0;

  if (!summary && !hasAudit) return null;

  return (
    <div className="min-w-0 space-y-2">
      {summary ? <ToolDetail label={labels.summary} value={summary} /> : null}
      {hasAudit ? (
        <ToolDetail label={labels.audit} value={JSON.stringify(audit, null, 2)} code />
      ) : null}
    </div>
  );
}

function toolCallLabel(toolName: string): string {
  const labels: Record<string, string> = {
    web_fetch: '读取网页',
    shell: '运行命令',
    read_file: '读取文件',
    write_file: '写入文件',
    export_file: '导出文件',
    create_website: '生成网站',
  };
  return labels[toolName] ?? toolName;
}

function AgentMessageMetadata() {
  const custom = useAuiState(({ message }) => message.metadata.custom) as AgentRunMetadataType;
  return (
    <AgentRunMetadata
      model={custom.model}
      runStatus={custom.runStatus}
      totalTokens={custom.totalTokens}
      modelCalls={custom.modelCalls}
      toolCalls={custom.toolCalls}
    />
  );
}

function isTextModelAlias(value: string): value is TextModelAlias {
  return ['qwen', 'glm', 'deepseek', 'kimi'].includes(value);
}
