import type { ChatFinishReason } from '@supermind/sdk'

import {
  OpenAICompatibleHttpError,
  OpenAICompatibleProtocolError,
  OpenAICompatibleTimeoutError,
} from '../transports/openai-compatible-chat.transport'
import type { OpenAICompatibleChatTransport } from '../transports/openai-compatible-chat.transport'
import type {
  ChatAdapter,
  ChatAdapterEvent,
  ChatAdapterRequest,
  ChatAdapterUsage,
} from './chat-adapter'
import { ChatAdapterError } from './chat-adapter'
import { toOpenAICompatibleMessages } from './openai-compatible-message'
import { openAICompatibleUsageDetails } from './openai-compatible-usage'
import {
  OpenAICompatibleToolCallAssembler,
  openAICompatibleToolRequestFields,
} from './openai-compatible-tool-calling'

export interface GlmChatAdapterOptions {
  apiKey: string
  baseUrl: string
  modelId: string
}

const UNKNOWN_USAGE: ChatAdapterUsage = Object.freeze({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  usageUnknown: true,
})

export class GlmChatAdapter implements ChatAdapter {
  readonly id = 'glm' as const
  readonly resolvedModel: string
  private readonly apiKey: string
  private readonly endpoint: string

  constructor(
    private readonly transport: OpenAICompatibleChatTransport,
    options: GlmChatAdapterOptions,
  ) {
    this.apiKey = nonEmpty(options.apiKey, 'GLM apiKey')
    this.resolvedModel = nonEmpty(options.modelId, 'GLM modelId')
    this.endpoint = endpoint(options.baseUrl)
  }

  async *stream(request: ChatAdapterRequest): AsyncIterable<ChatAdapterEvent> {
    let finishReason: ChatFinishReason | undefined
    let usage: ChatAdapterUsage | undefined
    let providerRequestId: string | undefined
    const toolCalls = new OpenAICompatibleToolCallAssembler('GLM', protocolError)
    const thinkingEffort = request.thinkingEffort ?? 'balanced'
    const enableThinking = thinkingEffort !== 'fast'

    try {
      for await (const event of this.transport.stream({
        url: this.endpoint,
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: {
          model: request.resolvedModel,
          messages: toOpenAICompatibleMessages(request.messages, {
            includeReasoningContent: enableThinking,
          }),
          stream: true,
          thinking: { type: enableThinking ? 'enabled' : 'disabled' },
          ...(thinkingEffort === 'balanced' ? { reasoning_effort: 'high' } : {}),
          ...(thinkingEffort === 'deep' ? { reasoning_effort: 'max' } : {}),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.topP === undefined ? {} : { top_p: request.topP }),
          ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
          ...openAICompatibleToolRequestFields(request),
        },
        signal: request.signal,
      })) {
        if (event.providerRequestId !== undefined) providerRequestId = event.providerRequestId
        if (event.type === 'done') {
          if (finishReason === undefined) throw protocolError('GLM stream ended without finish')
          toolCalls.assertStreamDone(finishReason)
          yield {
            type: 'usage',
            usage: usage ?? UNKNOWN_USAGE,
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
          yield {
            type: 'finish',
            finishReason,
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
          return
        }

        const chunk = parseChunk(event.data)
        if (chunk.toolCallDeltas !== undefined) toolCalls.addDeltas(chunk.toolCallDeltas)
        if (chunk.providerRequestId !== undefined) providerRequestId = chunk.providerRequestId
        if (chunk.reasoningContent !== undefined) {
          yield {
            type: 'reasoning',
            content: chunk.reasoningContent,
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
        }
        if (chunk.content !== undefined) {
          yield {
            type: 'delta',
            content: chunk.content,
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
        }
        if (chunk.usage !== undefined) {
          if (usage !== undefined) throw protocolError('GLM emitted usage more than once')
          usage = chunk.usage
        }
        if (chunk.finishReason !== undefined) {
          if (finishReason !== undefined) throw protocolError('GLM emitted finish more than once')
          for (const toolCall of toolCalls.finish(chunk.finishReason)) {
            yield {
              type: 'tool-call',
              toolCall,
              ...(providerRequestId === undefined ? {} : { providerRequestId }),
            }
          }
          finishReason = chunk.finishReason
        }
      }
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason
      throw mapError(error)
    }
  }
}

function parseChunk(data: unknown): {
  content?: string
  reasoningContent?: string
  finishReason?: ChatFinishReason
  toolCallDeltas?: unknown
  usage?: ChatAdapterUsage
  providerRequestId?: string
} {
  const chunk = record(data, 'GLM chunk')
  if (chunk.error !== undefined) {
    const error = record(chunk.error, 'GLM stream error')
    throw new ChatAdapterError(
      typeof error.message === 'string' ? error.message : 'GLM returned an error event',
      { code: 'GLM_STREAM_ERROR', retryable: false },
    )
  }
  const parsed: ReturnType<typeof parseChunk> = {}
  if (typeof chunk.request_id === 'string' && chunk.request_id.trim()) {
    parsed.providerRequestId = chunk.request_id
  }
  if (chunk.usage !== undefined && chunk.usage !== null) parsed.usage = parseUsage(chunk.usage)
  if (chunk.choices !== undefined) {
    if (!Array.isArray(chunk.choices)) throw protocolError('GLM choices must be an array')
    const choice = chunk.choices[0]
    if (choice !== undefined) {
      const value = record(choice, 'GLM choice')
      if (value.delta !== undefined && value.delta !== null) {
        const delta = record(value.delta, 'GLM delta')
        if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
          if (typeof delta.reasoning_content !== 'string') {
            throw protocolError('GLM reasoning_content must be text')
          }
          if (delta.reasoning_content) parsed.reasoningContent = delta.reasoning_content
        }
        if (delta.content !== undefined && delta.content !== null) {
          if (typeof delta.content !== 'string') throw protocolError('GLM content must be text')
          if (delta.content) parsed.content = delta.content
        }
        if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
          parsed.toolCallDeltas = delta.tool_calls
        }
      }
      if (value.finish_reason !== undefined && value.finish_reason !== null) {
        if (typeof value.finish_reason !== 'string') {
          throw protocolError('GLM finish_reason must be text')
        }
        parsed.finishReason = finishReason(value.finish_reason)
      }
    }
  }
  if (chunk.choices === undefined && chunk.usage === undefined) {
    throw protocolError('GLM chunk contains neither choices nor usage')
  }
  return parsed
}

function parseUsage(value: unknown): ChatAdapterUsage {
  const usage = record(value, 'GLM usage')
  return {
    inputTokens: token(usage.prompt_tokens, 'GLM prompt_tokens'),
    outputTokens: token(usage.completion_tokens, 'GLM completion_tokens'),
    totalTokens: token(usage.total_tokens, 'GLM total_tokens'),
    ...openAICompatibleUsageDetails(usage, 'GLM', protocolError),
    usageUnknown: false,
  }
}

function finishReason(value: string): ChatFinishReason {
  if (value === 'sensitive') return 'content_filter'
  if (
    value === 'stop' ||
    value === 'length' ||
    value === 'content_filter' ||
    value === 'tool_calls'
  ) {
    return value
  }
  return 'unknown'
}

function mapError(error: unknown): unknown {
  if (error instanceof ChatAdapterError) return error
  if (error instanceof OpenAICompatibleTimeoutError) {
    return new ChatAdapterError('GLM request timed out', {
      code: 'GLM_TIMEOUT',
      retryable: true,
      cause: error,
    })
  }
  if (error instanceof OpenAICompatibleHttpError) {
    return new ChatAdapterError(`GLM request failed with HTTP ${error.status}`, {
      code: httpCode(error.status),
      retryable: error.retryable,
      statusCode: error.status,
      ...(error.providerRequestId === undefined
        ? {}
        : { providerRequestId: error.providerRequestId }),
      cause: error,
    })
  }
  if (error instanceof OpenAICompatibleProtocolError) {
    return new ChatAdapterError('GLM returned an invalid streaming response', {
      code: 'GLM_PROTOCOL_ERROR',
      retryable: true,
      cause: error,
    })
  }
  return new ChatAdapterError('GLM request failed', {
    code: 'GLM_REQUEST_FAILED',
    retryable: true,
    cause: error,
  })
}

function httpCode(status: number): string {
  if (status === 400 || status === 422) return 'GLM_BAD_REQUEST'
  if (status === 401) return 'GLM_AUTHENTICATION_ERROR'
  if (status === 403) return 'GLM_ACCESS_DENIED'
  if (status === 404) return 'GLM_MODEL_NOT_FOUND'
  if (status === 408) return 'GLM_TIMEOUT'
  if (status === 429) return 'GLM_RATE_LIMITED'
  if (status >= 500) return 'GLM_UPSTREAM_UNAVAILABLE'
  return 'GLM_HTTP_ERROR'
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw protocolError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function token(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw protocolError(`${label} is invalid`)
  return value as number
}

function protocolError(message: string, cause?: unknown): ChatAdapterError {
  return new ChatAdapterError(message, {
    code: 'GLM_PROTOCOL_ERROR',
    retryable: true,
    ...(cause === undefined ? {} : { cause }),
  })
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${label} must be non-empty`)
  return normalized
}

function endpoint(baseUrl: string): string {
  const url = new URL(`${nonEmpty(baseUrl, 'GLM baseUrl').replace(/\/$/, '')}/`)
  if (url.protocol !== 'https:') throw new TypeError('GLM baseUrl must use HTTPS')
  return new URL('chat/completions', url).toString()
}
