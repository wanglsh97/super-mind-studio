'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { TextModelAlias, TextModelId } from '@supermind/sdk'
import {
  AssistantRuntimeProvider,
  AuiIf,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
} from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  AgentComposerAction,
  AgentComposerActions,
  AgentComposerDock,
  AgentComposerError,
  AgentComposerFooter,
  AgentComposerInput,
  AgentComposerRoot,
  AgentComposerSubmitGroup,
  AgentConsolePanel,
  AgentEmptyState,
  AgentPageShell,
  AgentPrivacyNote,
  AgentScrollToBottom,
  AgentSendButton,
  AgentThreadRoot,
  AgentThreadViewport,
  AssistantMessage,
  ChatUsageMetadata,
  ModelSelect,
  ParameterSliders,
  ResetThreadButton,
  UserMessage,
} from '../../components/chat-thread-ui'
import { ProtectedUserPage } from '../../components/protected-user-page'
import { useAuthenticationFailure } from '../../components/use-authentication-failure'
import { createAgentChatAdapter } from './agent-chat-adapter'
import type { AgentChatOptions, AgentMessageMetadata } from './agent-chat-adapter'

const client = createAIGatewayClient()
const examples = ['解释什么是 API 网关', '为周末杭州之旅列一个计划', '用简单比喻介绍大语言模型']

interface ModelOption {
  value: TextModelId
  label: string
  provider: TextModelAlias
}

const fallbackModelOptions: ReadonlyArray<ModelOption> = [
  { value: 'kimi-k3', label: 'Kimi K3', provider: 'kimi' },
  { value: 'qwen3.7-plus', label: 'Qwen3.7-Plus', provider: 'qwen' },
  { value: 'glm-5.2', label: 'GLM-5.2', provider: 'glm' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', provider: 'deepseek' },
]

export default function ChatPage() {
  return (
    <ProtectedUserPage>
      <ChatContent />
    </ProtectedUserPage>
  )
}

function ChatContent() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [selectedModel, setSelectedModel] = useState<TextModelId>('kimi-k3')
  const [modelOptions, setModelOptions] = useState(fallbackModelOptions)
  const [modelError, setModelError] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(0.9)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const optionsRef = useRef<AgentChatOptions>({
    model: selectedModel,
    modelName: modelOptions.find(({ value }) => value === selectedModel)?.label ?? selectedModel,
    temperature,
    topP,
    maxTokens,
  })
  optionsRef.current = {
    model: selectedModel,
    modelName: modelOptions.find(({ value }) => value === selectedModel)?.label ?? selectedModel,
    temperature,
    topP,
    maxTokens,
  }

  const adapter = useMemo(
    () =>
      createAgentChatAdapter(
        client,
        () => optionsRef.current,
        (error) => {
          handleAuthenticationFailure(error)
        },
      ),
    [handleAuthenticationFailure],
  )
  const runtime = useLocalRuntime(adapter)

  useEffect(() => {
    let active = true
    void client.models
      .list()
      .then((models) => {
        if (!active) return
        const enabled = models.flatMap((model) =>
          model.enabled && model.capabilities.includes('chat') && isTextModelAlias(model.alias)
            ? [{ value: model.id, label: model.displayName, provider: model.alias }]
            : [],
        )
        setModelOptions(enabled)
        if (enabled[0]) {
          setSelectedModel((current) =>
            enabled.some(({ value }) => value === current) ? current : enabled[0]!.value,
          )
        }
      })
      .catch(() => {
        if (active) setModelError('模型列表加载失败，请稍后刷新')
      })
    return () => {
      active = false
    }
  }, [])

  const modelDisabled = modelOptions.length === 0

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentPageShell>
        <AgentConsolePanel label="对话 Agent">
          <AgentThreadRoot>
            <AgentThreadViewport>
              <ThreadPrimitive.Empty>
                <AgentEmptyState
                  kicker="CURRENT THREAD · EMPTY"
                  title="从一个清晰的问题开始"
                  description="Agent 会携带这条会话中的上下文，持续给出流式回应。"
                  examples={examples}
                />
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages>
                {({ message }) =>
                  message.role === 'user' ? (
                    <UserMessage />
                  ) : (
                    <AssistantMessage
                      label="SUPER MIND · AGENT RESPONSE"
                      metadata={<ChatMessageMetadata />}
                    />
                  )
                }
              </ThreadPrimitive.Messages>
            </AgentThreadViewport>
            <AgentScrollToBottom />
            <AgentComposerDock>
              <AgentComposerRoot>
                {modelError ? <AgentComposerError message={modelError} /> : null}
                {settingsOpen ? (
                  <ParameterSliders
                    temperature={temperature}
                    topP={topP}
                    maxTokens={maxTokens}
                    onTemperatureChange={setTemperature}
                    onTopPChange={setTopP}
                    onMaxTokensChange={setMaxTokens}
                  />
                ) : null}
                <AgentComposerInput
                  placeholder="交给 Agent 一个任务…"
                  disabled={modelDisabled}
                  maxLength={4000}
                />
                <AgentComposerFooter>
                  <AgentComposerActions>
                    <AgentComposerAction href="/chat/compare">模型对比</AgentComposerAction>
                    <AgentComposerAction
                      expanded={settingsOpen}
                      onClick={() => setSettingsOpen((open) => !open)}
                    >
                      参数
                      <span aria-hidden="true">{settingsOpen ? '−' : '+'}</span>
                    </AgentComposerAction>
                    <ResetThreadButton />
                  </AgentComposerActions>
                  <AgentComposerSubmitGroup>
                    <ModelSelect
                      value={selectedModel}
                      options={modelOptions}
                      disabled={modelDisabled}
                      onChange={setSelectedModel}
                    />
                    <AuiIf condition={({ thread }) => thread.isRunning}>
                      <AgentSendButton cancel>停止</AgentSendButton>
                    </AuiIf>
                    <AuiIf condition={({ thread }) => !thread.isRunning}>
                      <AgentSendButton disabled={modelDisabled} />
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

function ChatMessageMetadata() {
  const custom = useAuiState(({ message }) => message.metadata.custom) as AgentMessageMetadata
  return (
    <ChatUsageMetadata usage={custom.usage} model={custom.model} requestId={custom.requestId} />
  )
}

function isTextModelAlias(value: string): value is TextModelAlias {
  return ['qwen', 'glm', 'deepseek', 'kimi'].includes(value)
}
