import { createHash } from 'node:crypto'

import type { AgentSkillFileEntry } from '@supermind/sdk'

import type {
  SkillObjectStorePort,
  SkillPackageDownload,
  SkillStoredObjectMetadata,
  StoredSkillPackage,
  StoredUserFile,
  UserFileDownload,
  WriteUserFileInput,
} from './skill-object-store.port'

const DEFAULT_FIXTURE_TIME = '2000-01-01T00:00:00.000Z'

export interface SkillPackageFixture {
  objectKey: string
  archive: Uint8Array
  skillMarkdown: string
  files: readonly AgentSkillFileEntry[]
  contentType?: string
  updatedAt?: string
}

export interface UserFileFixture {
  objectKey: string
  direction: 'input' | 'output'
  fileName: string
  bytes: Uint8Array
  contentType?: string
  updatedAt?: string
}

export interface InMemorySkillObjectStoreOptions {
  now?: () => Date
  skillPackages?: readonly SkillPackageFixture[]
  userFiles?: readonly UserFileFixture[]
}

type StoredObject = StoredSkillPackage | StoredUserFile

export class InMemorySkillObjectStore implements SkillObjectStorePort {
  private readonly objects = new Map<string, StoredObject>()
  private readonly now: () => Date

  constructor(options: InMemorySkillObjectStoreOptions = {}) {
    this.now = options.now ?? (() => new Date(DEFAULT_FIXTURE_TIME))
    for (const fixture of options.skillPackages ?? []) this.seedSkillPackage(fixture)
    for (const fixture of options.userFiles ?? []) this.seedUserFile(fixture)
  }

  async statObject(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<SkillStoredObjectMetadata | null> {
    throwIfAborted(signal)
    const object = this.objects.get(objectKey)
    return object ? { ...object.metadata } : null
  }

  async loadSkillPackage(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<StoredSkillPackage | null> {
    throwIfAborted(signal)
    const object = this.objects.get(objectKey)
    return isSkillPackage(object) ? clonePackage(object) : null
  }

  async createSkillPackageDownload(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<SkillPackageDownload | null> {
    throwIfAborted(signal)
    const object = this.objects.get(objectKey)
    if (!isSkillPackage(object)) return null
    return {
      metadata: { ...object.metadata },
      url: `data:application/zip;base64,${Buffer.from(object.archive).toString('base64')}`,
      expiresAt: new Date(this.now().getTime() + 60_000).toISOString(),
    }
  }

  async loadUserFile(objectKey: string, signal?: AbortSignal): Promise<StoredUserFile | null> {
    throwIfAborted(signal)
    const object = this.objects.get(objectKey)
    return object && !isSkillPackage(object) ? cloneUserFile(object) : null
  }

  async createUserFileDownload(
    objectKey: string,
    expiresInSeconds: number,
    signal?: AbortSignal,
  ): Promise<UserFileDownload | null> {
    throwIfAborted(signal)
    const object = this.objects.get(objectKey)
    if (!object || isSkillPackage(object)) return null
    return {
      metadata: { ...object.metadata },
      url: `data:${object.metadata.contentType};base64,${Buffer.from(object.bytes).toString('base64')}`,
      expiresAt: new Date(this.now().getTime() + expiresInSeconds * 1_000).toISOString(),
    }
  }

  async writeUserFile(input: WriteUserFileInput): Promise<StoredUserFile> {
    throwIfAborted(input.signal)
    const stored = createUserFile({
      objectKey: input.objectKey,
      direction: input.direction,
      fileName: input.fileName,
      bytes: input.bytes,
      contentType: input.contentType,
      updatedAt: this.now().toISOString(),
    })
    this.objects.set(input.objectKey, stored)
    return cloneUserFile(stored)
  }

  async deleteObject(objectKey: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    this.objects.delete(objectKey)
  }

  seedSkillPackage(fixture: SkillPackageFixture): StoredSkillPackage {
    assertObjectKey(fixture.objectKey)
    const files = normalizeFiles(fixture.files)
    const archive = copyBytes(fixture.archive)
    const stored: StoredSkillPackage = {
      metadata: {
        objectKey: fixture.objectKey,
        kind: 'skill-package',
        contentType: fixture.contentType ?? 'application/zip',
        sizeBytes: archive.byteLength,
        sha256: sha256(archive),
        updatedAt: fixture.updatedAt ?? this.now().toISOString(),
      },
      archive,
      skillMarkdown: fixture.skillMarkdown,
      files,
    }
    this.objects.set(fixture.objectKey, stored)
    return clonePackage(stored)
  }

  seedUserFile(fixture: UserFileFixture): StoredUserFile {
    const stored = createUserFile({
      ...fixture,
      contentType: fixture.contentType ?? 'application/octet-stream',
      updatedAt: fixture.updatedAt ?? this.now().toISOString(),
    })
    this.objects.set(fixture.objectKey, stored)
    return cloneUserFile(stored)
  }
}

function createUserFile(
  input: Omit<UserFileFixture, 'contentType' | 'updatedAt'> & {
    contentType: string
    updatedAt: string
  },
): StoredUserFile {
  assertObjectKey(input.objectKey)
  if (input.fileName.length === 0) throw new Error('User file fixture name must not be empty')
  const bytes = copyBytes(input.bytes)
  return {
    metadata: {
      objectKey: input.objectKey,
      kind: input.direction === 'input' ? 'user-input' : 'user-output',
      contentType: input.contentType,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      updatedAt: input.updatedAt,
    },
    fileName: input.fileName,
    bytes,
  }
}

function normalizeFiles(files: readonly AgentSkillFileEntry[]): AgentSkillFileEntry[] {
  const seen = new Set<string>()
  const normalized = files.map((file) => {
    if (file.path.length === 0 || seen.has(file.path)) {
      throw new Error(`Invalid or duplicate Skill fixture path: ${file.path}`)
    }
    seen.add(file.path)
    return { ...file }
  })
  return normalized.sort((left, right) => left.path.localeCompare(right.path))
}

function clonePackage(value: StoredSkillPackage): StoredSkillPackage {
  return {
    metadata: { ...value.metadata },
    archive: copyBytes(value.archive),
    skillMarkdown: value.skillMarkdown,
    files: value.files.map((file) => ({ ...file })),
  }
}

function cloneUserFile(value: StoredUserFile): StoredUserFile {
  return {
    metadata: { ...value.metadata },
    fileName: value.fileName,
    bytes: copyBytes(value.bytes),
  }
}

function isSkillPackage(value: StoredObject | undefined): value is StoredSkillPackage {
  return value?.metadata.kind === 'skill-package'
}

function copyBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value)
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertObjectKey(objectKey: string): void {
  if (objectKey.length === 0 || objectKey.startsWith('/') || objectKey.includes('..')) {
    throw new Error(`Invalid object key: ${objectKey}`)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Object store operation aborted')
}
