import { AIGatewayError } from './errors.js';

export const MAX_SKILL_PACKAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface SkillUploadProgress {
  phase: 'hashing' | 'uploading' | 'finalizing';
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  attempt: number;
}

export interface SkillPackageUploadOptions {
  signal?: AbortSignal;
  skillName?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?(progress: SkillUploadProgress): void;
}

export interface FinalizedSkillUpload {
  sessionId: string;
  status: 'finalized';
  sizeBytes: number;
  sha256: string;
  finalizedAt: string;
}

export interface CreateSkillUploadSessionRequest {
  sizeBytes: number;
  sha256: string;
  skillName?: string;
}

export interface SignedSkillUploadRequest {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface SkillUploadSession {
  id: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  expiresAt: string;
  upload: SignedSkillUploadRequest;
}

export interface SkillDirectUploadRequest {
  body: Blob;
  url: string;
  method: 'PUT';
  headers: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  onProgress?(loadedBytes: number, totalBytes: number): void;
}

export type SkillDirectUploadTransport = (request: SkillDirectUploadRequest) => Promise<void>;

export interface SkillUploadXmlHttpRequest {
  readonly upload: {
    onprogress:
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  };
  status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
}

export class SkillUploadTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SkillUploadTransportError';
  }
}

interface UploadSkillPackageDependencies {
  createSession(
    input: CreateSkillUploadSessionRequest,
    signal: AbortSignal | undefined,
  ): Promise<SkillUploadSession>;
  finalize(sessionId: string, signal: AbortSignal | undefined): Promise<FinalizedSkillUpload>;
  upload: SkillDirectUploadTransport;
  digest?(body: Blob): Promise<string>;
  delay?(milliseconds: number, signal: AbortSignal | undefined): Promise<void>;
}

export async function uploadSkillPackage(
  body: Blob,
  options: SkillPackageUploadOptions | undefined,
  dependencies: UploadSkillPackageDependencies,
): Promise<FinalizedSkillUpload> {
  validatePackage(body, options);
  throwIfAborted(options?.signal);
  reportProgress(options, 'hashing', 0, body.size, 0);
  const sha256 = await (dependencies.digest ?? sha256Hex)(body);
  throwIfAborted(options?.signal);
  reportProgress(options, 'hashing', body.size, body.size, 0);

  const session = await dependencies.createSession(
    {
      sizeBytes: body.size,
      sha256,
      ...(options?.skillName === undefined ? {} : { skillName: options.skillName }),
    },
    options?.signal,
  );
  assertSessionMatches(session, body.size, sha256);

  const maxRetries = options?.maxRetries ?? 2;
  const retryDelayMs = options?.retryDelayMs ?? 250;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await dependencies.upload({
        body,
        url: session.upload.url,
        method: session.upload.method,
        headers: session.upload.headers,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        onProgress: (loadedBytes, totalBytes) =>
          reportProgress(options, 'uploading', loadedBytes, totalBytes || body.size, attempt),
      });
      break;
    } catch (error) {
      throwIfAborted(options?.signal);
      const retryable =
        error instanceof SkillUploadTransportError ? error.retryable : isNetworkLikeError(error);
      if (!retryable || attempt > maxRetries) throw normalizeUploadError(error);
      await (dependencies.delay ?? abortableDelay)(
        retryDelayMs * 2 ** (attempt - 1),
        options?.signal,
      );
    }
  }

  throwIfAborted(options?.signal);
  reportProgress(options, 'finalizing', body.size, body.size, attempt);
  const finalized = await dependencies.finalize(session.id, options?.signal);
  if (finalized.sizeBytes !== body.size || finalized.sha256 !== sha256) {
    throw new AIGatewayError({
      requestId: session.id,
      code: 'SKILL_UPLOAD_FINALIZE_MISMATCH',
      message: 'Finalized Skill upload metadata does not match the selected package',
      retryable: false,
    });
  }
  return finalized;
}

export function createBrowserSkillUploadTransport(
  createRequest: () => SkillUploadXmlHttpRequest = createNativeXmlHttpRequest,
): SkillDirectUploadTransport {
  return (request) =>
    new Promise<void>((resolve, reject) => {
      const xhr = createRequest();
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener('abort', abort);
        callback();
      };
      const abort = () => {
        xhr.abort();
        finish(() => reject(request.signal?.reason ?? abortError()));
      };

      xhr.open(request.method, request.url, true);
      for (const [name, value] of Object.entries(request.headers))
        xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => {
        request.onProgress?.(
          event.loaded,
          event.lengthComputable ? event.total : request.body.size,
        );
      };
      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300;
        finish(() =>
          ok
            ? resolve()
            : reject(
                new SkillUploadTransportError(
                  `OSS upload failed with HTTP ${xhr.status}`,
                  xhr.status === 408 || xhr.status === 429 || xhr.status >= 500,
                  xhr.status,
                ),
              ),
        );
      };
      xhr.onerror = () =>
        finish(() => reject(new SkillUploadTransportError('OSS upload network error', true)));
      xhr.ontimeout = () =>
        finish(() => reject(new SkillUploadTransportError('OSS upload timed out', true)));
      xhr.onabort = () => finish(() => reject(request.signal?.reason ?? abortError()));

      if (request.signal?.aborted) {
        abort();
        return;
      }
      request.signal?.addEventListener('abort', abort, { once: true });
      xhr.send(request.body);
    });
}

function createNativeXmlHttpRequest(): SkillUploadXmlHttpRequest {
  const constructor = (
    globalThis as unknown as {
      XMLHttpRequest?: new () => SkillUploadXmlHttpRequest;
    }
  ).XMLHttpRequest;
  if (!constructor) throw new TypeError('XMLHttpRequest is required for browser Skill uploads');
  return new constructor();
}

export async function sha256Hex(body: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new TypeError('Web Crypto API is required to hash a Skill package');
  const digest = await subtle.digest('SHA-256', await body.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validatePackage(body: Blob, options: SkillPackageUploadOptions | undefined): void {
  if (body.size < 1 || body.size > MAX_SKILL_PACKAGE_UPLOAD_BYTES) {
    throw new TypeError(
      `Skill package must be between 1 and ${MAX_SKILL_PACKAGE_UPLOAD_BYTES} bytes`,
    );
  }
  const maxRetries = options?.maxRetries ?? 2;
  const retryDelayMs = options?.retryDelayMs ?? 250;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new TypeError('maxRetries must be an integer between 0 and 3');
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10_000) {
    throw new TypeError('retryDelayMs must be between 0 and 10000');
  }
}

function assertSessionMatches(
  session: SkillUploadSession,
  sizeBytes: number,
  sha256: string,
): void {
  if (session.expectedSizeBytes !== sizeBytes || session.expectedSha256 !== sha256) {
    throw new AIGatewayError({
      requestId: session.id,
      code: 'SKILL_UPLOAD_SESSION_MISMATCH',
      message: 'Skill upload session does not match the selected package',
      retryable: false,
    });
  }
}

function reportProgress(
  options: SkillPackageUploadOptions | undefined,
  phase: SkillUploadProgress['phase'],
  loadedBytes: number,
  totalBytes: number,
  attempt: number,
): void {
  const boundedLoaded = Math.max(0, Math.min(loadedBytes, totalBytes));
  options?.onProgress?.({
    phase,
    loadedBytes: boundedLoaded,
    totalBytes,
    percent: totalBytes === 0 ? 0 : Math.round((boundedLoaded / totalBytes) * 100),
    attempt,
  });
}

function normalizeUploadError(error: unknown): AIGatewayError {
  const status = error instanceof SkillUploadTransportError ? error.status : undefined;
  const retryable =
    error instanceof SkillUploadTransportError ? error.retryable : isNetworkLikeError(error);
  return new AIGatewayError(
    {
      requestId: 'oss-upload',
      code: 'SKILL_OSS_UPLOAD_FAILED',
      message: 'Skill package upload to OSS failed',
      retryable,
      ...(status === undefined ? {} : { details: { status } }),
    },
    { ...(status === undefined ? {} : { status }), cause: error },
  );
}

function isNetworkLikeError(error: unknown): boolean {
  return error instanceof TypeError;
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (milliseconds === 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? abortError());
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}
