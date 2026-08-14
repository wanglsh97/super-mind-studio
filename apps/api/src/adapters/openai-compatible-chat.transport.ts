import type { OnModuleDestroy } from '@nestjs/common'
import { Agent, fetch as undiciFetch } from 'undici'

export type OpenAICompatibleFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface OpenAICompatibleChatTransportOptions {
  fetch?: OpenAICompatibleFetch
  timeoutMs?: number
  connections?: number
}

export interface OpenAICompatibleChatTransportRequest {
  url: string
  headers?: Readonly<Record<string, string>>
  body: unknown
  signal: AbortSignal
  timeoutMs?: number
}

export type OpenAICompatibleChatTransportEvent =
  | {
      type: 'data'
      data: unknown
      providerRequestId?: string
    }
  | {
      type: 'done'
      providerRequestId?: string
    }

export class OpenAICompatibleHttpError extends Error {
  readonly retryable: boolean

  constructor(
    readonly status: number,
    readonly responseBody: unknown,
    readonly providerRequestId?: string,
  ) {
    super(`OpenAI-compatible upstream returned HTTP ${status}`)
    this.name = 'OpenAICompatibleHttpError'
    this.retryable = status === 408 || status === 429 || status >= 500
  }
}

export class OpenAICompatibleProtocolError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'OpenAICompatibleProtocolError'
  }
}

export class OpenAICompatibleTimeoutError extends Error {
  readonly retryable = true

  constructor(readonly timeoutMs: number) {
    super(`OpenAI-compatible upstream timed out after ${timeoutMs}ms`)
    this.name = 'OpenAICompatibleTimeoutError'
  }
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_CONNECTIONS = 20

export class OpenAICompatibleChatTransport implements OnModuleDestroy {
  private readonly fetchImplementation: OpenAICompatibleFetch
  private readonly timeoutMs: number
  private readonly agent: Agent | undefined

  constructor(options: OpenAICompatibleChatTransportOptions = {}) {
    const connections = validateConnections(options.connections ?? DEFAULT_CONNECTIONS)
    const timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.agent = options.fetch === undefined ? new Agent({ connections }) : undefined
    const fetchImplementation =
      options.fetch ??
      ((input, init) =>
        undiciFetch(String(input), { ...init, dispatcher: this.agent } as unknown as Parameters<
          typeof undiciFetch
        >[1]) as unknown as Promise<Response>)
    if (!fetchImplementation) throw new TypeError('A Fetch API implementation is required')

    this.fetchImplementation = fetchImplementation
    this.timeoutMs = timeoutMs
  }

  async onModuleDestroy(): Promise<void> {
    await this.agent?.close()
  }

  async *stream(
    request: OpenAICompatibleChatTransportRequest,
  ): AsyncGenerator<OpenAICompatibleChatTransportEvent, void, void> {
    const timeoutMs = validateTimeout(request.timeoutMs ?? this.timeoutMs)
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort(request.signal.reason)
    if (request.signal.aborted) abortFromCaller()
    else request.signal.addEventListener('abort', abortFromCaller, { once: true })

    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new OpenAICompatibleTimeoutError(timeoutMs))
    }, timeoutMs)

    try {
      const response = await this.fetchImplementation(request.url, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          ...request.headers,
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
      const providerRequestId = readProviderRequestId(response.headers)

      if (!response.ok) {
        throw new OpenAICompatibleHttpError(
          response.status,
          await readErrorBody(response),
          providerRequestId,
        )
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        throw new OpenAICompatibleProtocolError(
          'OpenAI-compatible upstream response is not text/event-stream',
        )
      }
      if (!response.body) {
        throw new OpenAICompatibleProtocolError(
          'OpenAI-compatible upstream response has no readable body',
        )
      }

      let done = false
      for await (const data of readSseData(response.body, controller.signal)) {
        if (data === '[DONE]') {
          done = true
          yield {
            type: 'done',
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
          }
          break
        }

        yield {
          type: 'data',
          data: parseJson(data),
          ...(providerRequestId === undefined ? {} : { providerRequestId }),
        }
      }

      if (!done) {
        throw new OpenAICompatibleProtocolError(
          'OpenAI-compatible upstream stream ended without [DONE]',
        )
      }
    } catch (error) {
      if (timedOut) throw new OpenAICompatibleTimeoutError(timeoutMs)
      if (request.signal.aborted) throw abortReason(request.signal)
      throw error
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', abortFromCaller)
      if (!controller.signal.aborted) controller.abort()
    }
  }
}

function validateTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('OpenAI-compatible timeoutMs must be a positive integer')
  }
  return timeoutMs
}

function validateConnections(connections: number): number {
  if (!Number.isInteger(connections) || connections <= 0) {
    throw new TypeError('OpenAI-compatible connections must be a positive integer')
  }
  return connections
}

function readProviderRequestId(headers: Headers): string | undefined {
  for (const name of ['x-request-id', 'x-request_id', 'request-id']) {
    const value = headers.get(name)?.trim()
    if (value) return value
  }
  return undefined
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text.slice(0, 8_192)
  }
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data) as unknown
  } catch (error) {
    throw new OpenAICompatibleProtocolError(
      'OpenAI-compatible upstream SSE data is not valid JSON',
      error,
    )
  }
}

async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  try {
    while (true) {
      const result = await readWithSignal(reader, signal)
      if (result.done) {
        completed = true
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(result.value, { stream: true })
      const parsed = extractSseEvents(buffer)
      buffer = parsed.remainder
      for (const data of parsed.events) yield data
    }

    if (buffer.trim()) {
      const data = parseSseBlock(buffer)
      if (data !== undefined) yield data
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> {
  if (signal.aborted) throw abortReason(signal)

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    void reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort)
      })
  })
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function extractSseEvents(value: string): { events: string[]; remainder: string } {
  const events: string[] = []
  let remainder = value

  while (true) {
    const separator = /\r?\n\r?\n/.exec(remainder)
    if (!separator || separator.index === undefined) break

    const block = remainder.slice(0, separator.index)
    remainder = remainder.slice(separator.index + separator[0].length)
    const data = parseSseBlock(block)
    if (data !== undefined) events.push(data)
  }

  return { events, remainder }
}

function parseSseBlock(block: string): string | undefined {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))

  return dataLines.length === 0 ? undefined : dataLines.join('\n')
}
