import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const BAILIAN_VIDEO_FETCH = Symbol('BAILIAN_VIDEO_FETCH');
export class BailianVideoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'BailianVideoError';
  }
}
export interface VideoTaskSnapshot {
  taskId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  resultUrl?: string;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class BailianVideoTransport {
  private readonly key: string;
  private readonly base: string;
  private readonly timeout: number;
  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Optional()
    @Inject(BAILIAN_VIDEO_FETCH)
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.key = config.get<string>('BAILIAN_IMAGE_API_KEY', '');
    this.base = normalize(config.get<string>('BAILIAN_IMAGE_BASE_URL', ''));
    this.timeout = 60_000;
  }
  isConfigured() {
    return Boolean(this.key && this.base);
  }
  async submit(
    path: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    const payload = await this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
      submission: true,
      idempotencyKey,
    });
    const taskId = read(payload, ['output', 'task_id']) ?? read(payload, ['task_id']);
    if (!taskId)
      throw new BailianVideoError('VIDEO_PROTOCOL_ERROR', '百炼视频响应缺少task_id', false);
    return { taskId, requestId: read(payload, ['request_id']) };
  }
  async query(taskId: string, signal?: AbortSignal): Promise<VideoTaskSnapshot> {
    assertId(taskId);
    const p = await this.request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      ...(signal ? { signal } : {}),
    });
    const raw = read(p, ['output', 'task_status']) ?? 'PENDING';
    const status =
      raw === 'SUCCEEDED' || raw === 'FAILED' || raw === 'CANCELLED' || raw === 'CANCELED'
        ? raw === 'CANCELED'
          ? 'CANCELLED'
          : raw
        : raw === 'RUNNING'
          ? 'RUNNING'
          : 'PENDING';
    const url = findUrl(p);
    return {
      taskId,
      status,
      ...(url ? { resultUrl: url } : {}),
      ...(read(p, ['request_id']) ? { requestId: read(p, ['request_id']) } : {}),
      ...(read(p, ['output', 'code']) ?? read(p, ['code'])
        ? { errorCode: read(p, ['output', 'code']) ?? read(p, ['code']) }
        : {}),
      ...(read(p, ['output', 'message']) ?? read(p, ['message'])
        ? { errorMessage: read(p, ['output', 'message']) ?? read(p, ['message']) }
        : {}),
    } as VideoTaskSnapshot;
  }
  async cancel(taskId: string) {
    try {
      await this.request(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
      return true;
    } catch {
      return false;
    }
  }
  private async request(
    path: string,
    input: {
      method: 'GET' | 'POST';
      body?: string;
      signal?: AbortSignal;
      submission?: boolean;
      idempotencyKey?: string;
    },
  ) {
    if (!this.isConfigured())
      throw new BailianVideoError('VIDEO_NOT_CONFIGURED', '百炼视频服务未配置', false);
    const timeout = AbortSignal.timeout(this.timeout);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method: input.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.key}`,
          ...(input.submission ? { 'X-DashScope-Async': 'enable' } : {}),
          ...(input.body ? { 'content-type': 'application/json' } : {}),
          ...(input.idempotencyKey ? { 'x-idempotency-key': input.idempotencyKey } : {}),
        },
        ...(input.body ? { body: input.body } : {}),
        signal,
        redirect: 'error',
      });
    } catch {
      throw new BailianVideoError(
        'VIDEO_TRANSPORT_ERROR',
        '百炼视频网络请求失败',
        true,
        input.submission === true,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok)
      throw new BailianVideoError(
        read(payload, ['code']) ?? `VIDEO_HTTP_${response.status}`,
        read(payload, ['message']) ?? '百炼视频请求失败',
        response.status === 429 || response.status >= 500,
      );
    return payload;
  }
}
function normalize(value: string) {
  if (!value) return '';
  const url = new URL(value);
  if (url.pathname === '/compatible-mode/v1') url.pathname = '/api/v1';
  return url.toString().replace(/\/$/, '');
}
function assertId(v: string) {
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(v))
    throw new BailianVideoError('INVALID_TASK_ID', '非法视频任务ID', false);
}
function read(v: unknown, path: string[]): string | undefined {
  let c: unknown = v;
  for (const k of path) {
    if (!c || typeof c !== 'object' || !(k in c)) return;
    c = (c as Record<string, unknown>)[k];
  }
  return typeof c === 'string' ? c : undefined;
}
function findUrl(p: Record<string, unknown>) {
  const o = p.output as Record<string, unknown> | undefined;
  for (const k of ['video_url', 'url']) if (typeof o?.[k] === 'string') return o[k] as string;
  const videos = o?.video;
  if (
    typeof videos === 'object' &&
    videos &&
    typeof (videos as Record<string, unknown>).url === 'string'
  )
    return (videos as Record<string, unknown>).url as string;
  return undefined;
}
