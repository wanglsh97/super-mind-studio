import { decodeAgentEvent, decodeAgentUserQuestion } from './agent-events.js';
import type {
  AgentSkillCandidate,
  AgentSkillMarketItem,
  UpdateAgentSkillRequest,
} from './agent-skill-types.js';
import type {
  AgentMcpServerStatus,
  AgentTokenAnalytics,
  AgentUserQuestion,
  AnswerAgentUserQuestionRequest,
  AgentRunSummary,
  AgentStreamEvent,
  AgentThread,
  AgentThreadListPage,
  AgentThreadSummary,
  CreateAgentRunRequest,
  CreateAgentThreadRequest,
  UpdateAgentThreadModelRequest,
  UpdateAgentThreadRequest,
  ImageModelCapability,
  UpdateAgentMcpServerRequest,
} from './agent-types.js';
import { AIGatewayAuthenticationError, AIGatewayError, AIGatewayProtocolError } from './errors.js';
import { readSseData } from './sse.js';
import {
  createBrowserSkillUploadTransport,
  uploadSkillPackage,
  type FinalizedSkillUpload,
  type SkillDirectUploadTransport,
  type SkillPackageUploadOptions,
  type SkillUploadSession,
} from './skill-upload.js';
import type { GatewayError } from './types.js';

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface AgentEventSubscribeOptions extends RequestOptions {
  /** 从该 sequence 之后开始接收事件（用于断线补读）。默认从头开始。 */
  after?: number;
}

export interface AgentThreadListOptions extends RequestOptions {
  page?: number;
  pageSize?: number;
}

export interface AgentTokenAnalyticsOptions extends RequestOptions {
  timezoneOffsetMinutes?: number;
}

export interface AgentClient {
  images: {
    models(options?: RequestOptions): Promise<{ enabled: boolean; models: ImageModelCapability[] }>;
    save(
      imageId: string,
      options?: RequestOptions,
    ): Promise<{ creationId: string; assetId: string | null; saved: true }>;
  };
  files: {
    upload(
      threadId: string,
      files: readonly Blob[],
      fileNames: readonly string[],
      options?: RequestOptions,
    ): Promise<{ files: Array<{ name: string; path: string; sizeBytes: number }> }>;
  };
  analytics: {
    get(options?: AgentTokenAnalyticsOptions): Promise<AgentTokenAnalytics>;
  };
  mcp: {
    servers(options?: RequestOptions): Promise<AgentMcpServerStatus[]>;
    update(
      serverId: string,
      input: UpdateAgentMcpServerRequest,
      options?: RequestOptions,
    ): Promise<AgentMcpServerStatus>;
  };
  skills: {
    list(options?: RequestOptions): Promise<AgentSkillMarketItem[]>;
    candidates(options?: RequestOptions): Promise<AgentSkillCandidate[]>;
    install(skillId: string, options?: RequestOptions): Promise<AgentSkillMarketItem>;
    update(
      skillId: string,
      input: UpdateAgentSkillRequest,
      options?: RequestOptions,
    ): Promise<AgentSkillMarketItem>;
    uninstall(skillId: string, options?: RequestOptions): Promise<void>;
    uploadPackage(body: Blob, options?: SkillPackageUploadOptions): Promise<FinalizedSkillUpload>;
  };
  threads: {
    create(input: CreateAgentThreadRequest, options?: RequestOptions): Promise<AgentThreadSummary>;
    list(options?: AgentThreadListOptions): Promise<AgentThreadListPage>;
    get(threadId: string, options?: RequestOptions): Promise<AgentThread>;
    rename(
      threadId: string,
      input: UpdateAgentThreadRequest,
      options?: RequestOptions,
    ): Promise<AgentThreadSummary>;
    updateModel(
      threadId: string,
      input: UpdateAgentThreadModelRequest,
      options?: RequestOptions,
    ): Promise<AgentThreadSummary>;
    delete(threadId: string, options?: RequestOptions): Promise<void>;
  };
  runs: {
    create(
      threadId: string,
      input: CreateAgentRunRequest,
      options?: RequestOptions,
    ): Promise<AgentRunSummary>;
    cancel(runId: string, options?: RequestOptions): Promise<AgentRunSummary>;
    /**
     * 订阅 run 事件流。按 sequence 递增产出事件；断线后可用最后 sequence 作为 `after` 重连补读。
     */
    subscribe(runId: string, options?: AgentEventSubscribeOptions): AsyncIterable<AgentStreamEvent>;
  };
  questions: {
    answer(
      questionId: string,
      input: AnswerAgentUserQuestionRequest,
      options?: RequestOptions,
    ): Promise<AgentUserQuestion>;
    skip(questionId: string, options?: RequestOptions): Promise<AgentUserQuestion>;
  };
}

export function createAgentClient(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  options: { skillUploadTransport?: SkillDirectUploadTransport } = {},
): AgentClient {
  const directUpload = options.skillUploadTransport ?? createBrowserSkillUploadTransport();
  return {
    images: {
      models: (requestOptions) =>
        requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/agent/images/models`,
          undefined,
          requestOptions,
        ),
      save: (imageId, requestOptions) =>
        requestJson(
          fetchImplementation,
          'POST',
          `${baseUrl}/api/v1/agent/images/${encodeURIComponent(imageId)}/save`,
          undefined,
          requestOptions,
        ),
    },
    files: {
      upload: async (threadId, files, fileNames, options) => {
        if (files.length !== fileNames.length) {
          throw new TypeError('files and fileNames must have the same length');
        }
        const body = new FormData();
        files.forEach((file, index) => body.append('files', file, fileNames[index]));
        const response = await fetchImplementation(
          `${baseUrl}/api/v1/agent/threads/${encodeURIComponent(threadId)}/files`,
          {
            method: 'POST',
            headers: { accept: 'application/json' },
            body,
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
          },
        );
        if (!response.ok) throw await responseError(response, response.headers.get('x-request-id'));
        return (await response.json()) as {
          files: Array<{ name: string; path: string; sizeBytes: number }>;
        };
      },
    },
    analytics: {
      get: async (options) => {
        const offset = options?.timezoneOffsetMinutes;
        const query =
          offset === undefined ? '' : `?timezoneOffsetMinutes=${encodeURIComponent(offset)}`;
        return decodeTokenAnalytics(
          await requestJson(
            fetchImplementation,
            'GET',
            `${baseUrl}/api/v1/agent/token-analytics${query}`,
            undefined,
            options,
          ),
        );
      },
    },
    mcp: {
      servers: async (options) => {
        const value = await requestJson<unknown>(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/agent/mcp/servers`,
          undefined,
          options,
        );
        if (!Array.isArray(value)) {
          throw new AIGatewayProtocolError('unknown', 'Agent MCP server status is not an array');
        }
        return value.map(decodeMcpServerStatus);
      },
      update: async (serverId, input, options) =>
        decodeMcpServerStatus(
          await requestJson(
            fetchImplementation,
            'PATCH',
            `${baseUrl}/api/v1/agent/mcp/servers/${encodeURIComponent(serverId)}`,
            input,
            options,
          ),
        ),
    },
    skills: {
      list: async (options) => {
        const value = await requestJson<unknown>(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/agent/skills`,
          undefined,
          options,
        );
        if (!Array.isArray(value))
          throw new AIGatewayProtocolError('unknown', 'Agent Skill catalog is not an array');
        return value.map(decodeSkillMarketItem);
      },
      candidates: async (options) => {
        const value = await requestJson<unknown>(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/agent/skills/executable/candidates`,
          undefined,
          options,
        );
        if (!Array.isArray(value))
          throw new AIGatewayProtocolError('unknown', 'Agent Skill candidates is not an array');
        return value.map(decodeSkillCandidate);
      },
      install: async (skillId, options) =>
        decodeSkillMarketItem(
          await requestJson(
            fetchImplementation,
            'PUT',
            `${baseUrl}/api/v1/agent/skills/${encodeURIComponent(skillId)}/install`,
            undefined,
            options,
          ),
        ),
      update: async (skillId, input, options) =>
        decodeSkillMarketItem(
          await requestJson(
            fetchImplementation,
            'PATCH',
            `${baseUrl}/api/v1/agent/skills/${encodeURIComponent(skillId)}`,
            input,
            options,
          ),
        ),
      uninstall: (skillId, options) =>
        requestVoid(
          fetchImplementation,
          'DELETE',
          `${baseUrl}/api/v1/agent/skills/${encodeURIComponent(skillId)}/install`,
          options,
        ),
      uploadPackage: (body, uploadOptions) =>
        uploadSkillPackage(body, uploadOptions, {
          createSession: async (input, signal) =>
            decodeSkillUploadSession(
              await requestJson(
                fetchImplementation,
                'POST',
                `${baseUrl}/api/v1/agent/skills/uploads`,
                input,
                { ...(signal === undefined ? {} : { signal }) },
              ),
            ),
          upload: directUpload,
          finalize: async (sessionId, signal) =>
            decodeFinalizedSkillUpload(
              await requestJson(
                fetchImplementation,
                'POST',
                `${baseUrl}/api/v1/agent/skills/uploads/${encodeURIComponent(sessionId)}/finalize`,
                undefined,
                { ...(signal === undefined ? {} : { signal }) },
              ),
            ),
        }),
    },
    threads: {
      create: (input, options) =>
        requestJson(fetchImplementation, 'POST', `${baseUrl}/api/v1/agent/threads`, input, options),
      list: (options) => {
        const params = new URLSearchParams();
        if (options?.page !== undefined) params.set('page', String(options.page));
        if (options?.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
        const query = params.toString();
        return requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/agent/threads${query ? `?${query}` : ''}`,
          undefined,
          options,
        );
      },
      get: (threadId, options) =>
        requestJson(
          fetchImplementation,
          'GET',
          `${baseUrl}/api/v1/agent/threads/${encodeURIComponent(threadId)}`,
          undefined,
          options,
        ),
      rename: (threadId, input, options) =>
        requestJson(
          fetchImplementation,
          'PATCH',
          `${baseUrl}/api/v1/agent/threads/${encodeURIComponent(threadId)}`,
          input,
          options,
        ),
      updateModel: (threadId, input, options) =>
        requestJson(
          fetchImplementation,
          'PATCH',
          `${baseUrl}/api/v1/agent/threads/${encodeURIComponent(threadId)}/model`,
          input,
          options,
        ),
      delete: (threadId, options) =>
        requestVoid(
          fetchImplementation,
          'DELETE',
          `${baseUrl}/api/v1/agent/threads/${encodeURIComponent(threadId)}`,
          options,
        ),
    },
    runs: {
      create: (threadId, input, options) =>
        requestJson(
          fetchImplementation,
          'POST',
          `${baseUrl}/api/v1/agent/threads/${encodeURIComponent(threadId)}/runs`,
          input,
          options,
        ),
      cancel: (runId, options) =>
        requestJson(
          fetchImplementation,
          'POST',
          `${baseUrl}/api/v1/agent/runs/${encodeURIComponent(runId)}/cancel`,
          undefined,
          options,
        ),
      subscribe: (runId, options) =>
        subscribeRunEvents(fetchImplementation, baseUrl, runId, options),
    },
    questions: {
      answer: async (questionId, input, options) =>
        decodeAgentUserQuestion(
          await requestJson(
            fetchImplementation,
            'POST',
            `${baseUrl}/api/v1/agent/questions/${encodeURIComponent(questionId)}/answer`,
            input,
            options,
          ),
        ),
      skip: async (questionId, options) =>
        decodeAgentUserQuestion(
          await requestJson(
            fetchImplementation,
            'POST',
            `${baseUrl}/api/v1/agent/questions/${encodeURIComponent(questionId)}/skip`,
            undefined,
            options,
          ),
        ),
    },
  };
}

function decodeTokenAnalytics(value: unknown): AgentTokenAnalytics {
  const record = asRecord(value);
  if (
    !record ||
    !stringValue(record.from) ||
    !stringValue(record.to) ||
    typeof record.timezoneOffsetMinutes !== 'number' ||
    !Array.isArray(record.daily) ||
    !Array.isArray(record.models)
  ) {
    throw new AIGatewayProtocolError('unknown', 'Agent Token analytics response is malformed');
  }
  return {
    from: record.from as string,
    to: record.to as string,
    timezoneOffsetMinutes: record.timezoneOffsetMinutes,
    daily: record.daily.map((item) => {
      const row = decodeTokenMetrics(item);
      const source = asRecord(item);
      if (!source || !stringValue(source.date)) {
        throw new AIGatewayProtocolError('unknown', 'Agent daily Token analytics is malformed');
      }
      return {
        date: source.date as string,
        modelCalls: metricNumber(source.modelCalls),
        cacheRate: rateNumber(source.cacheRate),
        ...row,
      };
    }),
    models: record.models.map((item) => {
      const row = decodeTokenMetrics(item);
      const source = asRecord(item);
      if (!source || !stringValue(source.model)) {
        throw new AIGatewayProtocolError('unknown', 'Agent model Token analytics is malformed');
      }
      return {
        model: source.model as string,
        modelCalls: metricNumber(source.modelCalls),
        cacheRate: rateNumber(source.cacheRate),
        ...row,
      };
    }),
  };
}

function decodeTokenMetrics(value: unknown) {
  const row = asRecord(value);
  if (!row) throw new AIGatewayProtocolError('unknown', 'Token metrics are malformed');
  return {
    inputTokens: metricNumber(row.inputTokens),
    outputTokens: metricNumber(row.outputTokens),
    totalTokens: metricNumber(row.totalTokens),
    cachedInputTokens: metricNumber(row.cachedInputTokens),
    reasoningTokens: metricNumber(row.reasoningTokens),
  };
}

function metricNumber(value: unknown): number {
  const parsed = numberValue(value);
  if (parsed === undefined)
    throw new AIGatewayProtocolError('unknown', 'Token metric is malformed');
  return parsed;
}

function rateNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AIGatewayProtocolError('unknown', 'Token rate is malformed');
  }
  return value;
}

function decodeMcpServerStatus(value: unknown): AgentMcpServerStatus {
  const record = asRecord(value);
  if (
    !record ||
    !stringValue(record.id) ||
    !stringValue(record.name) ||
    typeof record.version !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.enabled !== 'boolean' ||
    !['configured', 'ready', 'error', 'disabled'].includes(String(record.status)) ||
    numberValue(record.allowedToolCount) === undefined ||
    numberValue(record.discoveredToolCount) === undefined ||
    numberValue(record.registeredToolCount) === undefined ||
    !(record.errorCode === null || typeof record.errorCode === 'string')
  ) {
    throw new AIGatewayProtocolError('unknown', 'Agent MCP server status is malformed');
  }
  return {
    id: record.id as string,
    name: record.name as string,
    version: record.version as string,
    description: record.description as string,
    enabled: record.enabled as boolean,
    status: record.status as AgentMcpServerStatus['status'],
    allowedToolCount: record.allowedToolCount as number,
    discoveredToolCount: record.discoveredToolCount as number,
    registeredToolCount: record.registeredToolCount as number,
    errorCode: record.errorCode as string | null,
  };
}

function decodeSkillUploadSession(value: unknown): SkillUploadSession {
  const session = asRecord(value);
  const upload = asRecord(session?.upload);
  const headers = asRecord(upload?.headers);
  if (
    !session ||
    !stringValue(session.id) ||
    !numberValue(session.expectedSizeBytes) ||
    !stringValue(session.expectedSha256) ||
    !stringValue(session.expiresAt) ||
    !upload ||
    !stringValue(upload.url) ||
    upload.method !== 'PUT' ||
    !stringValue(upload.expiresAt) ||
    !headers ||
    !Object.values(headers).every((header) => typeof header === 'string')
  ) {
    throw new AIGatewayProtocolError('unknown', 'Skill upload session response is malformed');
  }
  return {
    id: session.id as string,
    expectedSizeBytes: session.expectedSizeBytes as number,
    expectedSha256: session.expectedSha256 as string,
    expiresAt: session.expiresAt as string,
    upload: {
      url: upload.url as string,
      method: 'PUT',
      expiresAt: upload.expiresAt as string,
      headers: headers as Record<string, string>,
    },
  };
}

function decodeFinalizedSkillUpload(value: unknown): FinalizedSkillUpload {
  const result = asRecord(value);
  if (
    !result ||
    !stringValue(result.sessionId) ||
    result.status !== 'finalized' ||
    !numberValue(result.sizeBytes) ||
    !stringValue(result.sha256) ||
    !stringValue(result.finalizedAt)
  ) {
    throw new AIGatewayProtocolError('unknown', 'Finalized Skill upload response is malformed');
  }
  return {
    sessionId: result.sessionId as string,
    status: 'finalized',
    sizeBytes: result.sizeBytes as number,
    sha256: result.sha256 as string,
    finalizedAt: result.finalizedAt as string,
  };
}

function decodeSkillMarketItem(value: unknown): AgentSkillMarketItem {
  const item = asRecord(value);
  const allowedTools = item?.allowedTools;
  if (
    !item ||
    !stringValue(item.id) ||
    !stringValue(item.name) ||
    !stringValue(item.version) ||
    typeof item.description !== 'string' ||
    !stringValue(item.category) ||
    !Array.isArray(allowedTools) ||
    !allowedTools.every((tool) => typeof tool === 'string') ||
    typeof item.installed !== 'boolean' ||
    typeof item.enabled !== 'boolean'
  ) {
    throw new AIGatewayProtocolError('unknown', 'Agent Skill response is malformed');
  }
  return {
    id: item.id as string,
    name: item.name as string,
    version: item.version as string,
    description: item.description,
    category: item.category as string,
    allowedTools,
    installed: item.installed,
    enabled: item.enabled,
  };
}

function decodeSkillCandidate(value: unknown): AgentSkillCandidate {
  const item = asRecord(value);
  if (
    !item ||
    !stringValue(item.id) ||
    !stringValue(item.name) ||
    !stringValue(item.title) ||
    typeof item.description !== 'string'
  ) {
    throw new AIGatewayProtocolError('unknown', 'Agent Skill candidate response is malformed');
  }
  return {
    id: item.id as string,
    name: item.name as string,
    title: item.title as string,
    description: item.description,
  };
}

export async function requestJson<T>(
  fetchImplementation: typeof globalThis.fetch,
  method: string,
  url: string,
  body: unknown,
  options: RequestOptions | undefined,
): Promise<T> {
  const response = await fetchImplementation(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  const requestId = response.headers.get('x-request-id');
  if (!response.ok) throw await responseError(response, requestId);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new AIGatewayProtocolError(
      requestId ?? 'unknown',
      'Agent response is not valid JSON',
      error,
    );
  }
}

export async function requestVoid(
  fetchImplementation: typeof globalThis.fetch,
  method: string,
  url: string,
  options: RequestOptions | undefined,
): Promise<void> {
  const response = await fetchImplementation(url, {
    method,
    headers: { accept: 'application/json' },
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) throw await responseError(response, response.headers.get('x-request-id'));
}

async function* subscribeRunEvents(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  runId: string,
  options: AgentEventSubscribeOptions | undefined,
): AsyncGenerator<AgentStreamEvent, void, void> {
  let previousSequence = options?.after ?? -1;
  const maximumReconnects = 4;

  for (let reconnects = 0; ; reconnects += 1) {
    if (options?.signal?.aborted) throw abortError();

    try {
      const url = `${baseUrl}/api/v1/agent/runs/${encodeURIComponent(runId)}/events?after=${previousSequence}`;
      const response = await fetchImplementation(url, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      const requestId = response.headers.get('x-request-id');
      if (!response.ok) throw await responseError(response, requestId);
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        throw new AIGatewayProtocolError(
          requestId ?? 'unknown',
          'Agent events response is not text/event-stream',
        );
      }
      if (!response.body) {
        throw new AIGatewayProtocolError(
          requestId ?? 'unknown',
          'Agent events response has no body',
        );
      }

      let done = false;
      for await (const data of readSseData(response.body)) {
        if (done) throw new AIGatewayProtocolError(runId, 'Agent SSE emitted data after [DONE]');
        if (data === '[DONE]') {
          done = true;
          continue;
        }
        const event = decodeAgentEvent(parseJson(data, runId), runId);
        if (event.sequence <= previousSequence) {
          throw new AIGatewayProtocolError(runId, 'Agent SSE emitted a non-increasing sequence');
        }
        previousSequence = event.sequence;
        yield event;
      }
      if (done) return;
      throw new AgentEventStreamInterruptedError();
    } catch (error) {
      if (options?.signal?.aborted || isAbortError(error)) throw error;
      if (!isRetryableAgentStreamError(error) || reconnects >= maximumReconnects) throw error;
      await waitForAgentStreamRetry(reconnects, options?.signal);
    }
  }
}

class AgentEventStreamInterruptedError extends Error {
  constructor() {
    super('Agent event stream ended before [DONE]');
    this.name = 'AgentEventStreamInterruptedError';
  }
}

function isRetryableAgentStreamError(error: unknown): boolean {
  return (
    error instanceof AgentEventStreamInterruptedError ||
    (!(error instanceof AIGatewayProtocolError) &&
      ((error instanceof AIGatewayError && error.retryable) || error instanceof TypeError))
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

async function waitForAgentStreamRetry(
  reconnects: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const delayMs = Math.min(100 * 2 ** reconnects, 800);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (!signal) return;
    signal.addEventListener('abort', onAbort, { once: true });
    timeout.unref?.();
    void Promise.resolve().then(() => {
      if (signal.aborted) onAbort();
    });
  });
}

function parseJson(data: string, runId: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new AIGatewayProtocolError(runId, 'Agent SSE data is not valid JSON', error);
  }
}

async function responseError(
  response: Response,
  headerRequestId: string | null,
): Promise<AIGatewayError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const record = asRecord(body);
  const requestId = stringValue(record?.requestId) ?? headerRequestId ?? 'unknown';
  const details = asRecord(record?.details);
  const error: GatewayError = {
    requestId,
    code: stringValue(record?.code) ?? `HTTP_${response.status}`,
    message: stringValue(record?.message) ?? `Agent request failed with HTTP ${response.status}`,
    retryable:
      booleanValue(record?.retryable) ?? (response.status === 429 || response.status >= 500),
    ...(details === undefined ? {} : { details }),
  };
  return response.status === 401
    ? new AIGatewayAuthenticationError(error)
    : new AIGatewayError(error, { status: response.status });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
