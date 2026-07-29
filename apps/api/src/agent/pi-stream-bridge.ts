import type { AgentThinkingEffort, ChatFinishReason } from '@supermind/sdk'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Tool,
  Usage,
} from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'

import type {
  ChatAdapterMessage,
  ChatAdapterToolChoice,
  ChatAdapterToolDefinition,
  ChatAdapterUsage,
} from '../chat/adapters/chat-adapter'
import type {
  ModelInvocationPort,
  ModelInvocationRequest,
  ModelStreamEvent,
} from '../chat/model-invocation.port'
import { loadPiAi } from './pi-runtime'

export interface PiMessageMeta {
  api: Api
  provider: string
  model: string
}

/**
 * 把 Pi `Context`（systemPrompt + LLM messages）转换为平台中立的适配器消息。
 */
export function piContextToInvocationMessages(context: Context): ChatAdapterMessage[] {
  const messages: ChatAdapterMessage[] = []
  if (context.systemPrompt && context.systemPrompt.length > 0) {
    messages.push({ role: 'system', content: context.systemPrompt })
  }
  for (const message of context.messages) {
    messages.push(convertPiMessage(message))
  }
  return messages
}

function convertPiMessage(message: Message): ChatAdapterMessage {
  if (message.role === 'user') {
    return { role: 'user', content: textOf(message.content) }
  }
  if (message.role === 'assistant') {
    const text = message.content
      .filter((part): part is TextContent => part.type === 'text')
      .map((part) => part.text)
      .join('')
    const toolCalls = message.content
      .filter((part): part is ToolCall => part.type === 'toolCall')
      .map((part) => ({ id: part.id, name: part.name, arguments: part.arguments }))
    const reasoningContent = message.content
      .filter((part): part is ThinkingContent => part.type === 'thinking')
      .map((part) => part.thinking)
      .join('')
    return {
      role: 'assistant',
      content: text,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  }
  return {
    role: 'tool',
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: textOf(message.content),
  }
}

function textOf(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

/**
 * 把 Pi 工具定义映射为平台中立的 JSON Schema 工具。
 */
export function piToolsToDefinitions(
  tools: readonly Tool[] | undefined,
): ChatAdapterToolDefinition[] {
  return (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
  }))
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function toPiUsage(usage: ChatAdapterUsage): Usage {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  return {
    input,
    output,
    cacheRead: usage.cachedInputTokens ?? 0,
    cacheWrite: 0,
    totalTokens: usage.totalTokens ?? input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function toDoneReason(
  reason: ChatFinishReason,
): Extract<StopReason, 'stop' | 'length' | 'toolUse'> {
  if (reason === 'length') return 'length'
  if (reason === 'tool_calls') return 'toolUse'
  return 'stop'
}

function emptyAssistant(meta: PiMessageMeta, now: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: meta.api,
    provider: meta.provider,
    model: meta.model,
    usage: zeroUsage(),
    stopReason: 'stop',
    timestamp: now,
  }
}

type OpenBlock = { kind: 'text' | 'thinking'; index: number } | undefined

/**
 * 纯映射：把 ModelInvocationPort 的统一事件流映射为 Pi AssistantMessageEvent 序列。
 *
 * - text → text_start/text_delta/text_end
 * - reasoning → thinking_start/thinking_delta/thinking_end
 * - tool-call → toolcall_start/toolcall_end
 * - usage → 累计入 message.usage（无独立事件）
 * - finish → done（映射 stopReason）
 * - 源抛错 → error 事件（signal 取消时 stopReason=aborted，否则 error），本生成器自身不抛错。
 */
export async function* mapModelStreamToPiEvents(
  source: AsyncIterable<ModelStreamEvent>,
  meta: PiMessageMeta,
  signal?: AbortSignal,
  now: () => number = () => Date.now(),
): AsyncGenerator<AssistantMessageEvent> {
  const message = emptyAssistant(meta, now())
  const content = message.content
  let open: OpenBlock

  const closeOpen = function* (): Generator<AssistantMessageEvent> {
    if (!open) return
    const block = content[open.index]
    if (open.kind === 'text' && block && block.type === 'text') {
      yield { type: 'text_end', contentIndex: open.index, content: block.text, partial: message }
    } else if (open.kind === 'thinking' && block && block.type === 'thinking') {
      yield {
        type: 'thinking_end',
        contentIndex: open.index,
        content: block.thinking,
        partial: message,
      }
    }
    open = undefined
  }

  yield { type: 'start', partial: message }

  try {
    for await (const event of source) {
      if (event.type === 'text') {
        if (open && open.kind !== 'text') yield* closeOpen()
        if (!open) {
          const block: TextContent = { type: 'text', text: '' }
          content.push(block)
          open = { kind: 'text', index: content.length - 1 }
          yield { type: 'text_start', contentIndex: open.index, partial: message }
        }
        const block = content[open.index] as TextContent
        block.text += event.delta
        yield { type: 'text_delta', contentIndex: open.index, delta: event.delta, partial: message }
        continue
      }

      if (event.type === 'reasoning') {
        if (open && open.kind !== 'thinking') yield* closeOpen()
        if (!open) {
          const block: ThinkingContent = { type: 'thinking', thinking: '' }
          content.push(block)
          open = { kind: 'thinking', index: content.length - 1 }
          yield { type: 'thinking_start', contentIndex: open.index, partial: message }
        }
        const block = content[open.index] as ThinkingContent
        block.thinking += event.delta
        yield {
          type: 'thinking_delta',
          contentIndex: open.index,
          delta: event.delta,
          partial: message,
        }
        continue
      }

      if (event.type === 'tool-call') {
        yield* closeOpen()
        const toolCall: ToolCall = {
          type: 'toolCall',
          id: event.toolCall.id,
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
        }
        content.push(toolCall)
        const index = content.length - 1
        yield { type: 'toolcall_start', contentIndex: index, partial: message }
        yield { type: 'toolcall_end', contentIndex: index, toolCall, partial: message }
        continue
      }

      if (event.type === 'usage') {
        message.usage = toPiUsage(event.usage)
        continue
      }

      // finish
      yield* closeOpen()
      message.stopReason = toDoneReason(event.finishReason)
      message.timestamp = now()
      yield { type: 'done', reason: toDoneReason(event.finishReason), message }
      return
    }

    // 源结束但未发出 finish：视为错误终态。
    yield* closeOpen()
    message.stopReason = 'error'
    message.errorMessage = '模型流在未产生 finish 事件前结束'
    yield { type: 'error', reason: 'error', error: message }
  } catch (error) {
    yield* closeOpen()
    const aborted = signal?.aborted === true || isAbortError(error)
    message.stopReason = aborted ? 'aborted' : 'error'
    message.errorMessage = errorMessage(error)
    yield { type: 'error', reason: aborted ? 'aborted' : 'error', error: message }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '模型调用失败'
}

export interface PiStreamFnDeps {
  port: ModelInvocationPort
  createRequestId: () => string
  thinkingEffort?: AgentThinkingEffort
  toolChoice?: ChatAdapterToolChoice
  temperature?: number
  topP?: number
  maxTokens?: number
  now?: () => number
  /** 每次模型调用（含 tool follow-up）执行的上下文装配/压缩入口。 */
  prepareMessages?: (
    messages: readonly ChatAdapterMessage[],
    tools: readonly ChatAdapterToolDefinition[],
  ) => Promise<readonly ChatAdapterMessage[]> | readonly ChatAdapterMessage[]
}

/**
 * 构造 Pi `StreamFn`：桥接 Pi harness 与平台 ModelInvocationPort。
 *
 * StreamFn 返回 Pi 的 push 式 `AssistantMessageEventStream`；后台异步把映射事件推入该流，
 * done/error 事件到达后流自动完成。StreamFn 契约要求不抛错，错误由 error 事件编码。
 */
export function createPiStreamFn(deps: PiStreamFnDeps): StreamFn {
  return async (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const { createAssistantMessageEventStream } = await loadPiAi()
    const stream = createAssistantMessageEventStream()
    const signal = options?.signal ?? new AbortController().signal

    const rawMessages = piContextToInvocationMessages(context)
    const tools = piToolsToDefinitions(context.tools)
    const invokePrepared = async function* (): AsyncGenerator<ModelStreamEvent> {
      const messages = (await deps.prepareMessages?.(rawMessages, tools)) ?? rawMessages
      const request: ModelInvocationRequest = {
        requestId: deps.createRequestId(),
        modelId: model.id,
        messages,
        tools,
        signal,
        ...(deps.thinkingEffort === undefined ? {} : { thinkingEffort: deps.thinkingEffort }),
        ...(deps.toolChoice === undefined ? {} : { toolChoice: deps.toolChoice }),
        ...(deps.temperature === undefined ? {} : { temperature: deps.temperature }),
        ...(deps.topP === undefined ? {} : { topP: deps.topP }),
        ...(deps.maxTokens === undefined ? {} : { maxTokens: deps.maxTokens }),
      }
      yield* deps.port.invoke(request)
    }
    const meta: PiMessageMeta = { api: model.api, provider: model.provider, model: model.id }

    void (async () => {
      for await (const event of mapModelStreamToPiEvents(
        invokePrepared(),
        meta,
        signal,
        deps.now,
      )) {
        stream.push(event)
      }
    })()

    return stream
  }
}

/**
 * 构造供 Pi Agent `initialState.model` 使用的合成模型。
 *
 * StreamFn 只用 `id` 路由到 ModelInvocationPort，其余字段为占位符；真实解析、鉴权与计费
 * 都在服务端端口内完成，不依赖该对象承载厂商配置。
 */
export function createPiModel(
  modelId: string,
  provider: string,
  contextWindow = 128_000,
): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider,
    baseUrl: 'https://gateway.internal/agent',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: 4096,
  }
}
