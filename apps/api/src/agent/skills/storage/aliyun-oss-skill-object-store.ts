import { createHash } from 'node:crypto'

import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OSS from 'ali-oss'

import type {
  SkillObjectStorePort,
  SkillPackageDownload,
  SkillStoredObjectKind,
  SkillStoredObjectMetadata,
  StoredSkillPackage,
  StoredUserFile,
  WriteUserFileInput,
} from './skill-object-store.port'
import { SkillPackageReader } from '../package/skill-package-reader'
import type {
  SignedSkillUpload,
  SignSkillUploadInput,
  SkillUploadSignerPort,
} from '../upload/skill-upload-signer.port'
import { requiredHeaders } from '../upload/in-memory-skill-upload-signer'

interface OssResponse {
  status?: number
  headers?: Record<string, unknown>
}

export interface OssClientPort {
  getBucketACL(bucket: string): Promise<{ acl: string }>
  head(name: string): Promise<{ status: number; meta?: Record<string, unknown>; res: OssResponse }>
  get(name: string): Promise<{ content?: unknown; res: OssResponse }>
  put(
    name: string,
    content: Buffer,
    options: { mime: string; meta: Record<string, string>; headers: Record<string, string> },
  ): Promise<unknown>
  delete(name: string): Promise<unknown>
  signatureUrlV4(
    method: 'GET' | 'PUT',
    expires: number,
    request: { headers: Record<string, string> },
    objectName: string,
    additionalHeaders: string[],
  ): Promise<string>
}

@Injectable()
export class AliyunOssSkillObjectStore
  implements SkillObjectStorePort, SkillUploadSignerPort, OnModuleInit
{
  constructor(
    private readonly client: OssClientPort,
    private readonly bucket: string,
    private readonly packageReader = new SkillPackageReader(),
  ) {}

  async onModuleInit(): Promise<void> {
    const { acl } = await this.client.getBucketACL(this.bucket)
    if (acl !== 'private') {
      throw new Error(`OSS Bucket 必须为 private，当前 ACL 为 ${acl || 'unknown'}`)
    }
  }

  async signSkillUpload(input: SignSkillUploadInput): Promise<SignedSkillUpload> {
    assertObjectKey(input.objectKey)
    const headers = requiredHeaders(input)
    const url = await this.client.signatureUrlV4(
      'PUT',
      input.expiresInSeconds,
      { headers },
      input.objectKey,
      Object.keys(headers).sort(),
    )
    return {
      url,
      method: 'PUT',
      headers,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString(),
    }
  }

  async statObject(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<SkillStoredObjectMetadata | null> {
    assertObjectKey(objectKey)
    throwIfAborted(signal)
    try {
      const result = await withAbort(this.client.head(objectKey), signal)
      return metadataFromResponse(objectKey, result.res, result.meta)
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }

  async createSkillPackageDownload(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<SkillPackageDownload | null> {
    const metadata = await this.statObject(objectKey, signal)
    if (!metadata || metadata.kind !== 'skill-package') return null
    const expiresInSeconds = 60
    const url = await withAbort(
      this.client.signatureUrlV4('GET', expiresInSeconds, { headers: {} }, objectKey, []),
      signal,
    )
    return {
      metadata: { ...metadata, kind: 'skill-package' },
      url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000).toISOString(),
    }
  }

  async loadSkillPackage(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<StoredSkillPackage | null> {
    const loaded = await this.loadBytes(objectKey, signal)
    if (!loaded || loaded.metadata.kind !== 'skill-package') return null
    const projection = await withAbort(this.packageReader.read(loaded.bytes), signal)
    return {
      metadata: { ...loaded.metadata, kind: 'skill-package' },
      archive: loaded.bytes,
      skillMarkdown: projection.skillMarkdown,
      files: projection.files.map((file) => ({ ...file })),
    }
  }

  async loadUserFile(objectKey: string, signal?: AbortSignal): Promise<StoredUserFile | null> {
    const loaded = await this.loadBytes(objectKey, signal)
    if (
      !loaded ||
      (loaded.metadata.kind !== 'user-input' && loaded.metadata.kind !== 'user-output')
    ) {
      return null
    }
    return {
      metadata: { ...loaded.metadata, kind: loaded.metadata.kind },
      fileName: loaded.fileName ?? objectKey.split('/').at(-1) ?? 'file',
      bytes: loaded.bytes,
    }
  }

  async createUserFileDownload(
    objectKey: string,
    expiresInSeconds: number,
    signal?: AbortSignal,
  ) {
    const metadata = await this.statObject(objectKey, signal)
    if (!metadata || metadata.kind === 'skill-package') return null
    const boundedExpiry = Math.min(Math.max(Math.trunc(expiresInSeconds), 60), 7_200)
    const url = await withAbort(
      this.client.signatureUrlV4('GET', boundedExpiry, { headers: {} }, objectKey, []),
      signal,
    )
    return {
      metadata: { ...metadata, kind: metadata.kind },
      url,
      expiresAt: new Date(Date.now() + boundedExpiry * 1_000).toISOString(),
    }
  }

  async writeUserFile(input: WriteUserFileInput): Promise<StoredUserFile> {
    assertObjectKey(input.objectKey)
    throwIfAborted(input.signal)
    const bytes = Buffer.from(input.bytes)
    const hash = sha256(bytes)
    const kind = input.direction === 'input' ? 'user-input' : 'user-output'
    await withAbort(
      this.client.put(input.objectKey, bytes, {
        mime: input.contentType,
        meta: { kind, sha256: hash, filename: input.fileName },
        headers: { 'x-oss-object-acl': 'private' },
      }),
      input.signal,
    )
    return {
      metadata: {
        objectKey: input.objectKey,
        kind,
        contentType: input.contentType,
        sizeBytes: bytes.byteLength,
        sha256: hash,
        updatedAt: new Date().toISOString(),
      },
      fileName: input.fileName,
      bytes: Uint8Array.from(bytes),
    }
  }

  async deleteObject(objectKey: string, signal?: AbortSignal): Promise<void> {
    assertObjectKey(objectKey)
    throwIfAborted(signal)
    try {
      await withAbort(this.client.delete(objectKey), signal)
    } catch (error) {
      if (!isMissingObject(error)) throw error
    }
  }

  private async loadBytes(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<{ metadata: SkillStoredObjectMetadata; bytes: Uint8Array; fileName?: string } | null> {
    assertObjectKey(objectKey)
    throwIfAborted(signal)
    try {
      const result = await withAbort(this.client.get(objectKey), signal)
      const bytes = toBytes(result.content)
      const metadata = metadataFromResponse(objectKey, result.res, undefined, bytes)
      const headers = normalizeHeaders(result.res.headers)
      return {
        metadata,
        bytes,
        ...(headers['x-oss-meta-filename'] ? { fileName: headers['x-oss-meta-filename'] } : {}),
      }
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }
}

export function createAliyunOssClient(config: ConfigService): {
  client: OssClientPort
  bucket: string
} {
  const bucket = config.getOrThrow<string>('OSS_BUCKET')
  const endpoint = config.get<string>('OSS_ENDPOINT')
  const client = new OSS({
    region: config.getOrThrow<string>('OSS_REGION'),
    bucket,
    accessKeyId: config.getOrThrow<string>('OSS_ACCESS_KEY_ID'),
    accessKeySecret: config.getOrThrow<string>('OSS_ACCESS_KEY_SECRET'),
    authorizationV4: true,
    secure: true,
    internal: config.get<boolean>('OSS_INTERNAL') ?? false,
    timeout: config.get<number>('OSS_TIMEOUT_MS') ?? 30_000,
    ...(endpoint ? { endpoint } : {}),
  })
  return { client: client as OssClientPort, bucket }
}

function metadataFromResponse(
  objectKey: string,
  response: OssResponse,
  meta?: Record<string, unknown>,
  content?: Uint8Array,
): SkillStoredObjectMetadata {
  const headers = normalizeHeaders(response.headers)
  const normalizedMeta = normalizeHeaders(meta)
  const kind = parseKind(normalizedMeta.kind ?? headers['x-oss-meta-kind'])
  const size = content?.byteLength ?? parseNonNegativeInt(headers['content-length'])
  const hash =
    content === undefined
      ? (normalizedMeta.sha256 ?? headers['x-oss-meta-sha256'])
      : sha256(content)
  if (size === null || !hash) throw new Error(`OSS 对象缺少受信元数据: ${objectKey}`)
  return {
    objectKey,
    kind,
    contentType: headers['content-type'] ?? 'application/octet-stream',
    sizeBytes: size,
    sha256: hash,
    updatedAt: parseDate(headers['last-modified']),
  }
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string' || typeof entry === 'number'
        ? [[key.toLowerCase(), String(entry)]]
        : [],
    ),
  )
}

function parseKind(value: string | undefined): SkillStoredObjectKind {
  if (value === 'skill-package' || value === 'user-input' || value === 'user-output') return value
  throw new Error('OSS 对象缺少有效 kind 元数据')
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseDate(value: string | undefined): string {
  if (!value) return new Date(0).toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

function toBytes(value: unknown): Uint8Array {
  if (Buffer.isBuffer(value)) return Uint8Array.from(value)
  if (value instanceof Uint8Array) return Uint8Array.from(value)
  throw new Error('OSS get 未返回二进制对象内容')
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertObjectKey(objectKey: string): void {
  if (!objectKey || objectKey.startsWith('/') || objectKey.includes('..')) {
    throw new Error(`Invalid object key: ${objectKey}`)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Object store operation aborted')
}

async function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return operation
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error('Object store operation aborted'),
          ),
        { once: true },
      )
    }),
  ])
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown }
  return (
    candidate.code === 'NoSuchKey' ||
    candidate.code === 'NoSuchObject' ||
    candidate.status === 404 ||
    candidate.statusCode === 404
  )
}
