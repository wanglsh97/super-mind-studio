import type { ChatFinishReason } from '@supermind/sdk'

import {
  OpenAICompatibleHttpError,
  OpenAICompatibleProtocolError,
  OpenAICompatibleTimeoutError,
} from './openai-compatible-chat.transport'
import type { OpenAICompatibleChatTransport } from './openai-compatible-chat.transport'
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

export interface DeepSeekChatAdapterOptions {
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

export class DeepSeekChatAdapter implements ChatAdapter {
  readonly id = 'deepseek' as const
  readonly resolvedModel: string
  private readonly apiKey: string
  private readonly endpoint: string

  constructor(
    private readonly transport: OpenAICompatibleChatTransport,
    options: DeepSeekChatAdapterOptions,
  ) {
    this.apiKey = nonEmpty(options.apiKey, 'DeepSeek apiKey')
    this.resolvedModel = nonEmpty(options.modelId, 'DeepSeek modelId')
    this.endpoint = endpoint(options.baseUrl)
  }

  async *stream(request: ChatAdapterRequest): AsyncIterable<ChatAdapterEvent> {
    let finishReason: ChatFinishReason | undefined
    let usage: ChatAdapterUsage | undefined
    let providerRequestId: string | undefined
    const toolCalls = new OpenAICompatibleToolCallAssembler('DeepSeek', protocolError)
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
          stream_options: { include_usage: true },
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
          if (finishReason === undefined)
            throw protocolError('DeepSeek stream ended without finish')
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
        if (chunk.reasoningContent !== undefined)
          yield {
            type: 'reasoning',
            content: chunk.reasoningContent,
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
        if (chunk.content !== undefined)
          yield {
            type: 'delta',
            content: chunk.content,
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
        if (chunk.usage !== undefined) {
          if (usage !== undefined) throw protocolError('DeepSeek emitted usage more than once')
          usage = chunk.usage
        }
        if (chunk.finishReason !== undefined) {
          if (finishReason !== undefined)
            throw protocolError('DeepSeek emitted finish more than once')
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

interface ParsedChunk {
  content?: string
  reasoningContent?: string
  finishReason?: ChatFinishReason
  toolCallDeltas?: unknown
  usage?: ChatAdapterUsage
  providerRequestId?: string
}

function parseChunk(data: unknown): ParsedChunk {
  const chunk = record(data, 'DeepSeek chunk')
  const parsed: ParsedChunk = {}
  if (typeof chunk.id === 'string' && chunk.id.trim()) parsed.providerRequestId = chunk.id
  if (chunk.usage !== undefined && chunk.usage !== null) parsed.usage = parseUsage(chunk.usage)
  if (chunk.choices !== undefined) {
    if (!Array.isArray(chunk.choices)) throw protocolError('DeepSeek choices must be an array')
    const choice = chunk.choices[0]
    if (choice !== undefined) {
      const value = record(choice, 'DeepSeek choice')
      if (value.delta !== undefined && value.delta !== null) {
        const delta = record(value.delta, 'DeepSeek delta')
        if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
          if (typeof delta.reasoning_content !== 'string')
            throw protocolError('DeepSeek reasoning_content must be text')
          if (delta.reasoning_content) parsed.reasoningContent = delta.reasoning_content
        }
        if (delta.content !== undefined && delta.content !== null) {
          if (typeof delta.content !== 'string')
            throw protocolError('DeepSeek content must be text')
          if (delta.content) parsed.content = delta.content
        }
        if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
          parsed.toolCallDeltas = delta.tool_calls
        }
      }
      if (value.finish_reason !== undefined && value.finish_reason !== null) {
        if (typeof value.finish_reason !== 'string')
          throw protocolError('DeepSeek finish_reason must be text')
        parsed.finishReason = finishReason(value.finish_reason)
      }
    }
  }
  if (chunk.choices === undefined && chunk.usage === undefined)
    throw protocolError('DeepSeek chunk contains neither choices nor usage')
  return parsed
}

function parseUsage(value: unknown): ChatAdapterUsage {
  const usage = record(value, 'DeepSeek usage')
  return {
    inputTokens: token(usage.prompt_tokens),
    outputTokens: token(usage.completion_tokens),
    totalTokens: token(usage.total_tokens),
    ...openAICompatibleUsageDetails(usage, 'DeepSeek', protocolError),
    usageUnknown: false,
  }
}

function finishReason(value: string): ChatFinishReason {
  return value === 'stop' ||
    value === 'length' ||
    value === 'content_filter' ||
    value === 'tool_calls'
    ? value
    : 'unknown'
}

function mapError(error: unknown): unknown {
  if (error instanceof ChatAdapterError) return error
  if (error instanceof OpenAICompatibleTimeoutError)
    return new ChatAdapterError('DeepSeek request timed out', {
      code: 'DEEPSEEK_TIMEOUT',
      retryable: true,
      cause: error,
    })
  if (error instanceof OpenAICompatibleHttpError)
    return new ChatAdapterError(`DeepSeek request failed with HTTP ${error.status}`, {
      code: httpCode(error.status),
      retryable: error.retryable,
      statusCode: error.status,
      ...(error.providerRequestId === undefined
        ? {}
        : { providerRequestId: error.providerRequestId }),
      cause: error,
    })
  if (error instanceof OpenAICompatibleProtocolError)
    return new ChatAdapterError('DeepSeek returned an invalid streaming response', {
      code: 'DEEPSEEK_PROTOCOL_ERROR',
      retryable: true,
      cause: error,
    })
  return new ChatAdapterError('DeepSeek request failed', {
    code: 'DEEPSEEK_REQUEST_FAILED',
    retryable: true,
    cause: error,
  })
}

function httpCode(status: number): string {
  if (status === 400 || status === 422) return 'DEEPSEEK_BAD_REQUEST'
  if (status === 401) return 'DEEPSEEK_AUTHENTICATION_ERROR'
  if (status === 402) return 'DEEPSEEK_INSUFFICIENT_BALANCE'
  if (status === 429) return 'DEEPSEEK_RATE_LIMITED'
  if (status >= 500) return 'DEEPSEEK_UPSTREAM_UNAVAILABLE'
  return 'DEEPSEEK_HTTP_ERROR'
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw protocolError(`${label} must be an object`)
  return value as Record<string, unknown>
}
function token(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0)
    throw protocolError('DeepSeek usage is invalid')
  return value as number
}
function protocolError(message: string, cause?: unknown): ChatAdapterError {
  return new ChatAdapterError(message, {
    code: 'DEEPSEEK_PROTOCOL_ERROR',
    retryable: true,
    ...(cause === undefined ? {} : { cause }),
  })
}
function nonEmpty(value: string, label: string): string {
  const result = value.trim()
  if (!result) throw new TypeError(`${label} must be non-empty`)
  return result
}
function endpoint(baseUrl: string): string {
  const url = new URL(`${nonEmpty(baseUrl, 'DeepSeek baseUrl').replace(/\/$/, '')}/`)
  if (url.protocol !== 'https:') throw new TypeError('DeepSeek baseUrl must use HTTPS')
  return new URL('chat/completions', url).toString()
}
