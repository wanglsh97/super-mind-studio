import type {
  GatewayError,
  ImageRequest,
  ImageTask,
  ModelSummary,
  OptimizePromptRequest,
  OptimizePromptResult,
} from './types.js'
import {
  AIGatewayAuthenticationError,
  AIGatewayError,
  AIGatewayProtocolError,
  AIGatewayTimeoutError,
} from './errors.js'
import { createAgentClient } from './agent-client.js'
import type { AgentClient } from './agent-client.js'
import type { SkillDirectUploadTransport } from './skill-upload.js'
import type { CreativeItem } from './creations.js'
import { requestCreativeJson } from './creations.js'
import {
  createAdminSkillClient,
  createSkillMarketClient,
  type AdminSkillClient,
  type SkillMarketClient,
} from './skill-market-client.js'

export interface RequestOptions {
  signal?: AbortSignal
}

export interface ImageWaitOptions extends RequestOptions {
  intervalMs?: number
  timeoutMs?: number
  onUpdate?(task: ImageTask): void
}

export interface CreateSuperMindClientOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  credentials?: 'omit' | 'same-origin' | 'include'
  skillUploadTransport?: SkillDirectUploadTransport
}

export interface SuperMindClient {
  images: {
    create(input: ImageRequest, options?: RequestOptions): Promise<ImageTask>
    get(taskId: string, options?: RequestOptions): Promise<ImageTask>
    wait(taskId: string, options?: ImageWaitOptions): Promise<ImageTask>
    downloadUrl(taskId: string, index: number): string
  }
  prompts: {
    optimize(input: OptimizePromptRequest, options?: RequestOptions): Promise<OptimizePromptResult>
  }
  models: {
    list(options?: RequestOptions): Promise<ModelSummary[]>
  }
  agent: AgentClient
  creations: {
    list(options?: RequestOptions): Promise<CreativeItem[]>
  }
  skills: SkillMarketClient
  admin: {
    skills: AdminSkillClient
  }
}

export function createSuperMindClient(options: CreateSuperMindClientOptions = {}): SuperMindClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (!fetchImplementation) throw new TypeError('A Fetch API implementation is required')
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const fetchWithCredentials: typeof globalThis.fetch = (input, init) =>
    fetchImplementation(input, {
      credentials: options.credentials ?? 'same-origin',
      ...init,
    })

  return {
    images: {
      create: (input, requestOptions) =>
        createImage(fetchWithCredentials, baseUrl, input, requestOptions),
      get: (taskId, requestOptions) =>
        getImage(fetchWithCredentials, baseUrl, taskId, requestOptions),
      wait: (taskId, waitOptions) =>
        waitForImage(fetchWithCredentials, baseUrl, taskId, waitOptions),
      downloadUrl: (taskId, index) => imageDownloadUrl(baseUrl, taskId, index),
    },
    prompts: {
      optimize: (input, requestOptions) =>
        optimizePrompt(fetchWithCredentials, baseUrl, input, requestOptions),
    },
    models: {
      list: (requestOptions) => listModels(fetchWithCredentials, baseUrl, requestOptions),
    },
    agent: createAgentClient(fetchWithCredentials, baseUrl, {
      ...(options.skillUploadTransport === undefined
        ? {}
        : { skillUploadTransport: options.skillUploadTransport }),
    }),
    creations: {
      list: (requestOptions) =>
        requestCreativeJson<CreativeItem[]>(fetchWithCredentials, `${baseUrl}/api/v1/creations`, {
          headers: { accept: 'application/json' },
          ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
        }),
    },
    skills: createSkillMarketClient(fetchWithCredentials, baseUrl),
    admin: {
      skills: createAdminSkillClient(fetchWithCredentials, baseUrl),
    },
  }
}


async function optimizePrompt(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  input: OptimizePromptRequest,
  options: RequestOptions | undefined,
): Promise<OptimizePromptResult> {
  const response = await fetchImplementation(`${baseUrl}/api/v1/prompts/optimize`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  })
  const headerRequestId = response.headers.get('x-request-id')
  if (!response.ok) throw await responseError(response, headerRequestId)

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new AIGatewayProtocolError(
      headerRequestId ?? 'unknown',
      'Prompt optimization response is not valid JSON',
      error,
    )
  }
  return parseOptimizePromptResult(body, headerRequestId)
}

function parseOptimizePromptResult(
  value: unknown,
  headerRequestId: string | null,
): OptimizePromptResult {
  const result = asRecord(value)
  const requestId = stringValue(result?.requestId)
  const model = stringValue(result?.model)
  const optimizedPrompt = stringValue(result?.optimizedPrompt)
  const templateVersion = stringValue(result?.templateVersion)
  const usage = asRecord(result?.usage)
  const protocolRequestId = requestId ?? headerRequestId ?? 'unknown'
  if (
    !result ||
    !requestId ||
    (headerRequestId !== null && requestId !== headerRequestId) ||
    !model ||
    !['qwen', 'glm', 'deepseek', 'kimi'].includes(model) ||
    !optimizedPrompt ||
    !templateVersion ||
    !usage
  ) {
    throw new AIGatewayProtocolError(protocolRequestId, 'Prompt optimization response is invalid')
  }

  return {
    requestId,
    model: model as OptimizePromptResult['model'],
    optimizedPrompt,
    templateVersion,
    usage: {
      inputTokens: nullableNumber(usage.inputTokens, requestId),
      outputTokens: nullableNumber(usage.outputTokens, requestId),
      totalTokens: nullableNumber(usage.totalTokens, requestId),
      estimatedCostCny: nullableString(usage.estimatedCostCny, requestId),
      usageUnknown: requiredBoolean(usage.usageUnknown, requestId),
    },
  }
}

async function createImage(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  input: ImageRequest,
  options: RequestOptions | undefined,
): Promise<ImageTask> {
  return requestImageTask(fetchImplementation, `${baseUrl}/api/v1/images/generations`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  })
}

async function getImage(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  taskId: string,
  options: RequestOptions | undefined,
): Promise<ImageTask> {
  return requestImageTask(
    fetchImplementation,
    `${baseUrl}/api/v1/images/generations/${encodeURIComponent(taskId)}`,
    {
      method: 'GET',
      headers: { accept: 'application/json' },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    },
  )
}

async function requestImageTask(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<ImageTask> {
  const response = await fetchImplementation(url, init)
  const requestId = response.headers.get('x-request-id')
  if (!response.ok) throw await responseError(response, requestId)
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new AIGatewayProtocolError(
      requestId ?? 'unknown',
      'Image task response is not valid JSON',
      error,
    )
  }
  return parseImageTask(body, requestId ?? 'unknown')
}

async function waitForImage(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  taskId: string,
  options: ImageWaitOptions | undefined,
): Promise<ImageTask> {
  const timeoutMs = options?.timeoutMs ?? 120_000
  let intervalMs = options?.intervalMs ?? 1_000
  if (timeoutMs <= 0 || intervalMs <= 0)
    throw new TypeError('Image wait intervals must be positive')
  const deadline = Date.now() + timeoutMs

  while (true) {
    const task = await getImage(fetchImplementation, baseUrl, taskId, options)
    options?.onUpdate?.(task)
    if (task.status === 'succeeded' || task.status === 'failed') return task
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new AIGatewayTimeoutError('images.wait', timeoutMs)
    await abortableDelay(Math.min(intervalMs, remaining), options?.signal)
    intervalMs = Math.min(5_000, Math.ceil(intervalMs * 1.5))
  }
}

function imageDownloadUrl(baseUrl: string, taskId: string, index: number): string {
  if (!Number.isInteger(index) || index < 0)
    throw new TypeError('Image index must be a non-negative integer')
  return `${baseUrl}/api/v1/images/generations/${encodeURIComponent(taskId)}/images/${index}/download`
}

function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new DOMException('The operation was aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function parseImageTask(value: unknown, requestId: string): ImageTask {
  const task = asRecord(value)
  const taskId = stringValue(task?.taskId)
  const model = stringValue(task?.model)
  const status = stringValue(task?.status)
  if (
    !task ||
    !taskId ||
    !model ||
    model !== 'mock-image' ||
    !status ||
    !['pending', 'running', 'succeeded', 'failed'].includes(status) ||
    !Array.isArray(task.results)
  ) {
    throw new AIGatewayProtocolError(requestId, 'Image task response is invalid')
  }
  return value as ImageTask
}

async function listModels(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  options: RequestOptions | undefined,
): Promise<ModelSummary[]> {
  const response = await fetchImplementation(`${baseUrl}/api/v1/models`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  })
  const requestId = response.headers.get('x-request-id')

  if (!response.ok) throw await responseError(response, requestId)

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new AIGatewayProtocolError(
      requestId ?? 'unknown',
      'Models response is not valid JSON',
      error,
    )
  }

  if (!Array.isArray(body)) {
    throw new AIGatewayProtocolError(requestId ?? 'unknown', 'Models response must be an array')
  }

  return body.map((value) => parseModelSummary(value, requestId ?? 'unknown'))
}

function parseModelSummary(value: unknown, requestId: string): ModelSummary {
  const model = asRecord(value)
  const id = stringValue(model?.id)
  const alias = stringValue(model?.alias)
  const modelId = model?.modelId === undefined ? undefined : stringValue(model.modelId)
  const displayName = stringValue(model?.displayName)
  const capabilities = model?.capabilities
  const enabled = booleanValue(model?.enabled)
  const configured = booleanValue(model?.configured)
  const health = model?.health

  if (
    !model ||
    !id ||
    !alias ||
    !['qwen', 'glm', 'deepseek', 'kimi', 'mock-image'].includes(alias) ||
    !displayName ||
    (model?.modelId !== undefined && !modelId) ||
    !Array.isArray(capabilities) ||
    !capabilities.every((item) => ['chat', 'image', 'prompt', 'agent'].includes(String(item))) ||
    enabled === undefined ||
    configured === undefined ||
    !['unknown', 'healthy', 'unhealthy'].includes(String(health))
  ) {
    throw new AIGatewayProtocolError(requestId, 'Models response contains an invalid model summary')
  }

  return value as ModelSummary
}

async function responseError(response: Response, headerRequestId: string | null) {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  const record = asRecord(body)
  const requestId = stringValue(record?.requestId) ?? headerRequestId ?? 'unknown'
  const details = asRecord(record?.details)
  const error: GatewayError = {
    requestId,
    code: stringValue(record?.code) ?? `HTTP_${response.status}`,
    message: stringValue(record?.message) ?? `Gateway request failed with HTTP ${response.status}`,
    retryable:
      booleanValue(record?.retryable) ?? (response.status === 429 || response.status >= 500),
    ...(details === undefined ? {} : { details }),
  }
  return response.status === 401
    ? new AIGatewayAuthenticationError(error)
    : new AIGatewayError(error, { status: response.status })
}

function nullableNumber(value: unknown, requestId: string): number | null {
  if (value === null || typeof value === 'number') return value
  throw new AIGatewayProtocolError(requestId, 'Usage token value must be a number or null')
}

function nullableString(value: unknown, requestId: string): string | null {
  if (value === null || typeof value === 'string') return value
  throw new AIGatewayProtocolError(requestId, 'Usage cost value must be a string or null')
}

function requiredBoolean(value: unknown, requestId: string): boolean {
  if (typeof value === 'boolean') return value
  throw new AIGatewayProtocolError(requestId, 'Usage unknown flag must be a boolean')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
