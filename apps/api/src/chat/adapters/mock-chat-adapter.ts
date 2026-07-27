import { Inject, Injectable } from '@nestjs/common'

import type {
  ChatAdapter,
  ChatAdapterEvent,
  ChatAdapterMessage,
  ChatAdapterRequest,
  ChatAdapterToolCall,
  ChatAdapterUsage,
} from './chat-adapter'
import { ChatAdapterError } from './chat-adapter'

export type MockChatFailurePhase = 'before-first-delta' | 'after-first-delta'

export interface MockChatFailure {
  phase: MockChatFailurePhase
  code?: string
  message?: string
  retryable?: boolean
  statusCode?: number
}

export interface MockChatAdapterOptions {
  chunks: readonly string[]
  delayMs: number
  usage?: ChatAdapterUsage
  failure?: MockChatFailure
  /** Agent tool-calling 模式是否发出模拟的 provider reasoning，默认 true。 */
  emitReasoning?: boolean
}

export const MOCK_CHAT_ADAPTER_OPTIONS = Symbol('MOCK_CHAT_ADAPTER_OPTIONS')

export const DEFAULT_MOCK_CHAT_ADAPTER_OPTIONS: MockChatAdapterOptions = Object.freeze({
  chunks: Object.freeze(['这是 ', 'Mock Adapter ', '的确定性流式响应。']),
  delayMs: 25,
})

const DEFAULT_FETCH_URL = 'https://example.com/'

/**
 * 确定性 Mock Chat Adapter。
 *
 * 普通 Chat（无 tools）：发出配置好的 chunk、usage 与 finish。
 * Agent 模式（请求带 tools）：根据 messages 中已有 tool result 数量与最近 user 指令，
 * 确定性模拟 reasoning、web_fetch tool call、tool result 后续 turn、最终答案、模型流错误
 * 与取消，供 Pi harness 完成 tool-call → tool-result → follow-up 闭环。
 *
 * 指令（写在 user 消息中，便于测试驱动确定性场景）：
 * - `FETCH:<n>`：需要 n 次 web_fetch 后再作答（默认 1）。
 * - `SCENARIO:unknown-tool`：首轮请求一个未注册工具。
 * - `SCENARIO:invalid-args`：首轮请求缺少 url 的 web_fetch。
 * - `SCENARIO:shell`：首轮请求 OpenSandbox Shell 执行确定性 Mock Skill 命令。
 * - `SCENARIO:stream-error`：首轮以模型流错误终止。
 * - `URL:<url>` 或消息中的 http(s) 链接：作为 web_fetch 目标。
 */
@Injectable()
export class MockChatAdapter implements ChatAdapter {
  readonly id = 'mock' as const
  readonly resolvedModel = 'mock-chat-v1'

  constructor(@Inject(MOCK_CHAT_ADAPTER_OPTIONS) private readonly options: MockChatAdapterOptions) {
    if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
      throw new TypeError('Mock Chat delayMs must be a non-negative integer')
    }
    if (options.chunks.length === 0 || options.chunks.some((chunk) => chunk.length === 0)) {
      throw new TypeError('Mock Chat chunks must contain at least one non-empty chunk')
    }
  }

  async *stream(request: ChatAdapterRequest): AsyncIterable<ChatAdapterEvent> {
    const providerRequestId = `mock-${request.requestId}`

    if (this.options.failure?.phase === 'before-first-delta') {
      await this.waitForDelay(request.signal)
      throw this.createFailure(this.options.failure, providerRequestId)
    }

    if ((request.tools?.length ?? 0) > 0) {
      yield* this.streamAgentTurn(request, providerRequestId)
      return
    }

    yield* this.streamPlainChat(request, providerRequestId)
  }

  private async *streamPlainChat(
    request: ChatAdapterRequest,
    providerRequestId: string,
  ): AsyncIterable<ChatAdapterEvent> {
    for (const [index, content] of this.options.chunks.entries()) {
      await this.waitForDelay(request.signal)
      yield { type: 'delta', content, providerRequestId }

      if (index === 0 && this.options.failure?.phase === 'after-first-delta') {
        await this.waitForDelay(request.signal)
        throw this.createFailure(this.options.failure, providerRequestId)
      }
    }

    this.throwIfAborted(request.signal)
    yield {
      type: 'usage',
      usage: this.options.usage ?? this.calculateUsage(request, this.options.chunks.join('')),
      providerRequestId,
    }
    yield { type: 'finish', finishReason: 'stop', providerRequestId }
  }

  private async *streamAgentTurn(
    request: ChatAdapterRequest,
    providerRequestId: string,
  ): AsyncIterable<ChatAdapterEvent> {
    const instruction = latestUserText(request.messages)
    const directives = parseDirectives(instruction)
    const completedFetches = countToolResults(request.messages)
    let emittedContent = ''

    const maybeFailAfterFirst = async (): Promise<void> => {
      if (this.options.failure?.phase === 'after-first-delta') {
        await this.waitForDelay(request.signal)
        throw this.createFailure(this.options.failure, providerRequestId)
      }
    }

    if (completedFetches < directives.wantFetches) {
      if (directives.scenario === 'stream-error') {
        await this.waitForDelay(request.signal)
        throw new ChatAdapterError('Mock 模型流错误', {
          code: 'MOCK_AGENT_STREAM_ERROR',
          retryable: false,
          providerRequestId,
        })
      }

      if (this.options.emitReasoning !== false && completedFetches === 0) {
        await this.waitForDelay(request.signal)
        yield { type: 'reasoning', content: '需要联网获取实时信息以回答问题。', providerRequestId }
        await maybeFailAfterFirst()
      }

      await this.waitForDelay(request.signal)
      const toolCall = this.buildToolCall(directives, completedFetches)
      yield { type: 'tool-call', toolCall, providerRequestId }
      await maybeFailAfterFirst()

      this.throwIfAborted(request.signal)
      yield {
        type: 'usage',
        usage: this.calculateUsage(request, JSON.stringify(toolCall)),
        providerRequestId,
      }
      yield { type: 'finish', finishReason: 'tool_calls', providerRequestId }
      return
    }

    if (this.options.emitReasoning !== false) {
      await this.waitForDelay(request.signal)
      yield { type: 'reasoning', content: '已获得检索结果，正在整理答案。', providerRequestId }
      await maybeFailAfterFirst()
    }

    const answer = buildAnswer(request.messages, completedFetches)
    for (const [index, chunk] of answer.entries()) {
      await this.waitForDelay(request.signal)
      yield { type: 'delta', content: chunk, providerRequestId }
      emittedContent += chunk
      if (index === 0) await maybeFailAfterFirst()
    }

    this.throwIfAborted(request.signal)
    yield {
      type: 'usage',
      usage: this.calculateUsage(request, emittedContent),
      providerRequestId,
    }
    yield { type: 'finish', finishReason: 'stop', providerRequestId }
  }

  private buildToolCall(directives: MockDirectives, completedFetches: number): ChatAdapterToolCall {
    const id = `call_${completedFetches + 1}`
    if (directives.scenario === 'unknown-tool') {
      return { id, name: 'nonexistent_tool', arguments: { reason: 'mock unknown tool' } }
    }
    if (directives.scenario === 'invalid-args') {
      return { id, name: 'web_fetch', arguments: {} }
    }
    if (directives.scenario === 'shell') {
      return {
        id,
        name: 'shell',
        arguments: {
          command: 'node scripts/clean.mjs',
          workingDirectory: '/workspace/skills/mock-data-cleaner',
        },
      }
    }
    return { id, name: 'web_fetch', arguments: { url: directives.url } }
  }

  private calculateUsage(request: ChatAdapterRequest, outputText: string): ChatAdapterUsage {
    if (this.options.usage) return this.options.usage
    const inputText = request.messages.map((message) => message.content).join('')
    const inputTokens = this.estimateTokens(inputText)
    const outputTokens = this.estimateTokens(outputText)
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      usageUnknown: false,
    }
  }

  private estimateTokens(value: string): number {
    const codePoints = Array.from(value).length
    return codePoints === 0 ? 0 : Math.ceil(codePoints / 4)
  }

  private createFailure(failure: MockChatFailure, providerRequestId: string): ChatAdapterError {
    return new ChatAdapterError(failure.message ?? 'Configured Mock Chat failure', {
      code: failure.code ?? 'MOCK_CHAT_FAILURE',
      retryable: failure.retryable ?? true,
      statusCode: failure.statusCode ?? 503,
      providerRequestId,
    })
  }

  private async waitForDelay(signal: AbortSignal): Promise<void> {
    this.throwIfAborted(signal)
    if (this.options.delayMs === 0) return

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, this.options.delayMs)
      const onAbort = () => {
        clearTimeout(timer)
        reject(this.abortError())
      }

      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw this.abortError()
  }

  private abortError(): DOMException {
    return new DOMException('The operation was aborted', 'AbortError')
  }
}

type MockScenario = 'normal' | 'unknown-tool' | 'invalid-args' | 'stream-error' | 'shell'

interface MockDirectives {
  wantFetches: number
  scenario: MockScenario
  url: string
}

function parseDirectives(instruction: string): MockDirectives {
  const fetchMatch = /FETCH:(\d+)/i.exec(instruction)
  const wantFetches = fetchMatch ? Math.max(1, Number.parseInt(fetchMatch[1] ?? '1', 10)) : 1

  let scenario: MockScenario = 'normal'
  if (/SCENARIO:unknown-tool/i.test(instruction)) scenario = 'unknown-tool'
  else if (/SCENARIO:invalid-args/i.test(instruction)) scenario = 'invalid-args'
  else if (/SCENARIO:stream-error/i.test(instruction)) scenario = 'stream-error'
  else if (/SCENARIO:shell/i.test(instruction)) scenario = 'shell'

  const explicitUrl = /URL:(\S+)/i.exec(instruction)?.[1]
  const linkUrl = /https?:\/\/[^\s"')]+/i.exec(instruction)?.[0]
  const url = explicitUrl ?? linkUrl ?? DEFAULT_FETCH_URL

  return { wantFetches, scenario, url }
}

function latestUserText(messages: readonly ChatAdapterMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && message.role === 'user') return message.content
  }
  return ''
}

function countToolResults(messages: readonly ChatAdapterMessage[]): number {
  return messages.filter((message) => message.role === 'tool').length
}

function buildAnswer(messages: readonly ChatAdapterMessage[], fetches: number): readonly string[] {
  const lastResult = [...messages].reverse().find((message) => message.role === 'tool')
  const snippet = (lastResult?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return [`已根据 ${fetches} 个检索来源整理答案：`, snippet.length > 0 ? snippet : '（无正文）']
}
