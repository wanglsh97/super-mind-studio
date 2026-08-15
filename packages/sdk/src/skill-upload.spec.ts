import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AIGatewayError } from './errors.js';
import {
  createBrowserSkillUploadTransport,
  SkillUploadTransportError,
  uploadSkillPackage,
} from './skill-upload.js';

const sha256 = 'a'.repeat(64);

describe('uploadSkillPackage', () => {
  it('retries only the signed OSS PUT, reports progress and finalizes once', async () => {
    const body = new Blob(['zip']);
    const phases: string[] = [];
    let creates = 0;
    let uploads = 0;
    let finalizes = 0;

    const result = await uploadSkillPackage(
      body,
      {
        skillName: 'published-skill',
        maxRetries: 1,
        retryDelayMs: 0,
        onProgress: (progress) => phases.push(`${progress.phase}:${progress.attempt}`),
      },
      {
        digest: async () => sha256,
        createSession: async (input) => {
          creates += 1;
          assert.deepEqual(input, { sizeBytes: 3, sha256, skillName: 'published-skill' });
          return session();
        },
        upload: async (request) => {
          uploads += 1;
          assert.equal(request.body, body);
          request.onProgress?.(3, 3);
          if (uploads === 1) throw new SkillUploadTransportError('temporary', true, 503);
        },
        finalize: async (sessionId) => {
          finalizes += 1;
          assert.equal(sessionId, 'session-1');
          return finalized();
        },
      },
    );

    assert.deepEqual(result, finalized());
    assert.equal(creates, 1);
    assert.equal(uploads, 2);
    assert.equal(finalizes, 1);
    assert.ok(phases.includes('uploading:2'));
    assert.equal(phases.at(-1), 'finalizing:2');
  });

  it('does not retry non-retryable PUT failures and rejects finalize mismatches', async () => {
    const dependencies = {
      digest: async () => sha256,
      createSession: async () => session(),
      upload: async () => undefined,
      finalize: async () => ({ ...finalized(), sha256: 'b'.repeat(64) }),
    };
    await assert.rejects(
      () => uploadSkillPackage(new Blob(['zip']), { retryDelayMs: 0 }, dependencies),
      (error: unknown) =>
        error instanceof AIGatewayError && error.code === 'SKILL_UPLOAD_FINALIZE_MISMATCH',
    );

    let attempts = 0;
    await assert.rejects(
      () =>
        uploadSkillPackage(
          new Blob(['zip']),
          { maxRetries: 3, retryDelayMs: 0 },
          {
            ...dependencies,
            upload: async () => {
              attempts += 1;
              throw new SkillUploadTransportError('forbidden', false, 403);
            },
          },
        ),
      (error: unknown) =>
        error instanceof AIGatewayError &&
        error.code === 'SKILL_OSS_UPLOAD_FAILED' &&
        error.status === 403,
    );
    assert.equal(attempts, 1);
  });

  it('propagates cancellation to an active direct upload and skips finalize', async () => {
    const controller = new AbortController();
    let finalizes = 0;
    const promise = uploadSkillPackage(
      new Blob(['zip']),
      { signal: controller.signal, retryDelayMs: 0 },
      {
        digest: async () => sha256,
        createSession: async () => session(),
        upload: (request) =>
          new Promise<void>((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => reject(request.signal?.reason), {
              once: true,
            });
            controller.abort(new DOMException('cancelled', 'AbortError'));
          }),
        finalize: async () => {
          finalizes += 1;
          return finalized();
        },
      },
    );
    await assert.rejects(promise, (error: unknown) => error instanceof DOMException);
    assert.equal(finalizes, 0);
  });
});

describe('createBrowserSkillUploadTransport', () => {
  it('sends the Blob with signed headers and reports XMLHttpRequest progress', async () => {
    const xhr = new FakeXmlHttpRequest();
    const body = new Blob(['zip']);
    let loaded = 0;
    await createBrowserSkillUploadTransport(() => xhr)({
      body,
      url: 'https://bucket.oss.example/staging?signature=redacted',
      method: 'PUT',
      headers: { 'content-type': 'application/zip', 'x-oss-meta-sha256': sha256 },
      onProgress: (value) => {
        loaded = value;
      },
    });

    assert.equal(xhr.method, 'PUT');
    assert.equal(xhr.sentBody, body);
    assert.equal(xhr.headers.get('x-oss-meta-sha256'), sha256);
    assert.equal(loaded, 3);
  });
});

function session() {
  return {
    id: 'session-1',
    expectedSizeBytes: 3,
    expectedSha256: sha256,
    expiresAt: '2026-07-23T00:05:00.000Z',
    upload: {
      url: 'https://bucket.oss.example/staging?signature=redacted',
      method: 'PUT' as const,
      headers: { 'content-type': 'application/zip' },
      expiresAt: '2026-07-23T00:05:00.000Z',
    },
  };
}

function finalized() {
  return {
    sessionId: 'session-1',
    status: 'finalized' as const,
    sizeBytes: 3,
    sha256,
    finalizedAt: '2026-07-23T00:01:00.000Z',
  };
}

class FakeXmlHttpRequest {
  readonly upload: {
    onprogress:
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  } = { onprogress: null };
  readonly headers = new Map<string, string>();
  status = 0;
  method = '';
  sentBody: Blob | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string, async: boolean): void {
    void url;
    void async;
    this.method = method;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  send(body: Blob): void {
    this.sentBody = body;
    this.upload.onprogress?.({ loaded: 3, total: 3, lengthComputable: true });
    this.status = 200;
    this.onload?.();
  }

  abort(): void {
    this.onabort?.();
  }
}
