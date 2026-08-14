import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BailianSubmitRequest {
  path: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  asynchronous?: boolean;
}

export interface BailianTaskSnapshot {
  taskId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  resultUrl?: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export class BailianTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'BailianTransportError';
  }
}

export const BAILIAN_IMAGE_FETCH = Symbol('BAILIAN_IMAGE_FETCH');

@Injectable()
export class BailianAsyncImageTransport {
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Optional() @Inject(BAILIAN_IMAGE_FETCH) fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.timeoutMs = 60_000;
    this.apiKey = config.get<string>('BAILIAN_IMAGE_API_KEY', '');
    this.baseUrl = normalizeNativeBaseUrl(config.get<string>('BAILIAN_IMAGE_BASE_URL', ''));
    this.fetchImpl = fetchImpl;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  async submit(
    request: BailianSubmitRequest,
  ): Promise<{ taskId: string; requestId?: string; resultUrl?: string }> {
    const payload = await this.request(request.path, {
      method: 'POST',
      body: JSON.stringify(request.body),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      asyncSubmission: request.asynchronous !== false,
      submission: true,
    });
    const requestId = readString(payload, ['request_id']);
    const taskId =
      readString(payload, ['output', 'task_id']) ?? readString(payload, ['task_id']) ?? requestId;
    const resultUrl = findResultUrl(payload);
    if (!taskId || (request.asynchronous !== false && !readString(payload, ['output', 'task_id'])))
      throw new BailianTransportError('BAILIAN_PROTOCOL_ERROR', '百炼提交响应缺少 task_id', false);
    return { taskId, ...(requestId ? { requestId } : {}), ...(resultUrl ? { resultUrl } : {}) };
  }

  async query(taskId: string, signal?: AbortSignal): Promise<BailianTaskSnapshot> {
    assertProviderTaskId(taskId);
    const payload = await this.request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
    const rawStatus =
      readString(payload, ['output', 'task_status']) ??
      readString(payload, ['task_status']) ??
      'PENDING';
    const status = normalizeStatus(rawStatus);
    const resultUrl = findResultUrl(payload);
    return {
      taskId,
      status,
      ...(resultUrl ? { resultUrl } : {}),
      ...(readString(payload, ['request_id'])
        ? { requestId: readString(payload, ['request_id'])! }
        : {}),
      ...(readString(payload, ['code']) ? { errorCode: readString(payload, ['code'])! } : {}),
      ...(readString(payload, ['message'])
        ? { errorMessage: readString(payload, ['message'])! }
        : {}),
    };
  }

  async cancel(taskId: string, signal?: AbortSignal): Promise<boolean> {
    assertProviderTaskId(taskId);
    try {
      await this.request(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
      });
      return true;
    } catch (error) {
      if (error instanceof BailianTransportError && !error.retryable) return false;
      throw error;
    }
  }

  private async request(
    path: string,
    input: {
      method: 'GET' | 'POST';
      body?: string;
      signal?: AbortSignal;
      asyncSubmission?: boolean;
      submission?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    if (!this.isConfigured())
      throw new BailianTransportError('BAILIAN_NOT_CONFIGURED', '百炼图片服务未配置', false);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: input.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(input.body ? { 'content-type': 'application/json' } : {}),
          ...(input.asyncSubmission ? { 'X-DashScope-Async': 'enable' } : {}),
        },
        ...(input.body ? { body: input.body } : {}),
        signal,
      });
    } catch {
      const aborted = input.signal?.aborted === true;
      throw new BailianTransportError(
        aborted ? 'IMAGE_CANCELLED' : 'BAILIAN_TRANSPORT_ERROR',
        aborted ? '图片请求已取消' : '百炼网络请求失败',
        !aborted,
        input.submission === true && !aborted,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = readString(payload, ['code']) ?? `BAILIAN_HTTP_${response.status}`;
      const message = readString(payload, ['message']) ?? '百炼图片请求失败';
      throw new BailianTransportError(
        code,
        message,
        response.status === 429 || response.status >= 500,
      );
    }
    return payload;
  }
}

function normalizeNativeBaseUrl(configured: string): string {
  const value = configured.replace(/\/$/, '');
  if (!value) return '';
  const url = new URL(value);
  if (url.pathname === '/compatible-mode/v1') url.pathname = '/api/v1';
  return url.toString().replace(/\/$/, '');
}

function assertProviderTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(taskId))
    throw new BailianTransportError('INVALID_TASK_ID', '非法百炼任务ID', false);
}

function readString(value: unknown, path: string[]): string | undefined {
  let cursor: unknown = value;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null || !(key in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function normalizeStatus(status: string): BailianTaskSnapshot['status'] {
  if (status === 'CANCELED') return 'CANCELLED';
  if (status === 'UNKNOWN') return 'FAILED';
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status))
    return status as BailianTaskSnapshot['status'];
  return status === 'RUNNING' ? 'RUNNING' : 'PENDING';
}

function findResultUrl(payload: Record<string, unknown>): string | undefined {
  const output = payload.output as Record<string, unknown> | undefined;
  const direct = output?.url;
  if (typeof direct === 'string') return direct;
  for (const key of ['results', 'choices']) {
    const values = output?.[key];
    if (!Array.isArray(values)) continue;
    const first = values[0];
    if (typeof first !== 'object' || first === null) continue;
    for (const field of ['url', 'image_url']) {
      const value = (first as Record<string, unknown>)[field];
      if (typeof value === 'string') return value;
    }
    const message = (first as Record<string, unknown>).message;
    if (typeof message === 'object' && message !== null) {
      const content = (message as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            typeof part === 'object' &&
            part !== null &&
            typeof (part as Record<string, unknown>).image === 'string'
          )
            return (part as Record<string, unknown>).image as string;
        }
      }
    }
  }
  return undefined;
}
