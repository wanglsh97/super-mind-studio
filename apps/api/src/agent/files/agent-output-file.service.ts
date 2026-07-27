import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'

import { Inject, Injectable } from '@nestjs/common'

import type { UserFile } from '../../generated/prisma/client'
import { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
  type StoredUserFile,
} from '../skills/storage/skill-object-store.port'
import { AgentOutputFileError, AgentOutputFileRepository } from './agent-output-file.repository'

const MIB = 1024 * 1024
export const MAX_OUTPUT_FILE_BYTES = 100 * MIB
export const MAX_RUN_OUTPUT_BYTES = 100 * MIB
export const MAX_USER_FILE_BYTES = 1024 * MIB
export const OUTPUT_ROOT = '/workspace/output'

export interface AgentOutputFileReference {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
  path: string
  contentUrl: string
  downloadUrl: string
}

@Injectable()
export class AgentOutputFileService {
  constructor(
    @Inject(AgentOutputFileRepository) private readonly files: AgentOutputFileRepository,
    @Inject(AgentExecutionSessionService)
    private readonly sessions: AgentExecutionSessionService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
  ) {}

  async export(
    runId: string,
    userId: string,
    requestedPath: string,
    signal?: AbortSignal,
  ): Promise<AgentOutputFileReference> {
    const sandboxPath = normalizeOutputPath(requestedPath)
    const current = await this.files.findOutput(runId, sandboxPath)
    if (current?.status === 'AVAILABLE') return toReference(current)
    if (current) {
      throw new AgentOutputFileError(
        'OUTPUT_STORAGE_FAILED',
        '该产物正在导出或等待存储清理，请稍后重试',
        true,
      )
    }

    const sandboxFile = await this.sessions.readOutputFile(runId, userId, sandboxPath, signal)
    if (!sandboxFile) {
      throw new AgentOutputFileError('OUTPUT_FILE_NOT_FOUND', `产物不存在：${sandboxPath}`)
    }
    if (sandboxFile.sizeBytes < 1) {
      throw new AgentOutputFileError('OUTPUT_FILE_INVALID', '不能导出空文件')
    }
    if (sandboxFile.sizeBytes > MAX_OUTPUT_FILE_BYTES) {
      throw new AgentOutputFileError(
        'OUTPUT_FILE_TOO_LARGE',
        `单个产物不能超过 ${MAX_OUTPUT_FILE_BYTES / MIB} MiB`,
      )
    }

    const id = randomUUID()
    const name = safeFileName(posix.basename(sandboxPath))
    const mimeType = detectMimeType(name, sandboxFile.bytes)
    const objectKey = `user-files/${userId}/output/${id}`
    const reserved = await this.files.reserve({
      id,
      userId,
      runId,
      sandboxPath,
      name,
      mimeType,
      objectKey,
      sizeBytes: sandboxFile.sizeBytes,
      sha256: sandboxFile.sha256,
      maxRunBytes: MAX_RUN_OUTPUT_BYTES,
      maxUserBytes: MAX_USER_FILE_BYTES,
    })
    if (reserved.status === 'AVAILABLE') return toReference(reserved)
    if (reserved.id !== id) {
      throw new AgentOutputFileError(
        'OUTPUT_STORAGE_FAILED',
        '该产物正在由另一个导出请求处理，请稍后重试',
        true,
      )
    }

    try {
      const stored = await this.objects.writeUserFile({
        objectKey,
        direction: 'output',
        fileName: name,
        contentType: mimeType,
        bytes: sandboxFile.bytes,
        ...(signal === undefined ? {} : { signal }),
      })
      if (
        stored.metadata.sizeBytes !== sandboxFile.sizeBytes ||
        stored.metadata.sha256 !== sandboxFile.sha256
      ) {
        throw new AgentOutputFileError('OUTPUT_STORAGE_FAILED', 'OSS 中的产物完整性校验失败', true)
      }
      return toReference(await this.files.markAvailable(id))
    } catch (error) {
      await this.objects.deleteObject(objectKey).catch(() => undefined)
      await this.files.releaseReservation(id)
      if (error instanceof AgentOutputFileError) throw error
      throw new AgentOutputFileError(
        'OUTPUT_STORAGE_FAILED',
        error instanceof Error ? error.message : '产物上传 OSS 失败',
        true,
      )
    }
  }

  async loadForOwner(
    fileId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<{ record: UserFile; stored: StoredUserFile }> {
    const record = await this.files.findAvailableForOwner(fileId, userId)
    if (!record) throw new AgentOutputFileError('OUTPUT_FILE_NOT_FOUND', '文件不存在')
    const stored = await this.objects.loadUserFile(record.objectKey, signal)
    if (!stored) {
      throw new AgentOutputFileError('OUTPUT_FILE_NOT_FOUND', '文件内容不存在')
    }
    return { record, stored }
  }
}

export function normalizeOutputPath(requestedPath: string): string {
  const trimmed = requestedPath.trim()
  if (!trimmed) throw new AgentOutputFileError('OUTPUT_FILE_INVALID', '产物路径不能为空')
  const candidate = trimmed.startsWith('/')
    ? posix.normalize(trimmed)
    : posix.join(OUTPUT_ROOT, trimmed)
  if (candidate === OUTPUT_ROOT || !candidate.startsWith(`${OUTPUT_ROOT}/`)) {
    throw new AgentOutputFileError('OUTPUT_FILE_INVALID', `只能导出 ${OUTPUT_ROOT} 目录下的文件`)
  }
  return candidate
}

function safeFileName(value: string): string {
  const normalized = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 || character === '/' || character === '\\'
      ? '_'
      : character
  })
    .join('')
    .trim()
  return normalized.slice(0, 255) || 'artifact'
}

function detectMimeType(name: string, bytes: Uint8Array): string {
  const extension = posix.extname(name).toLowerCase()
  const known: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.zip': 'application/zip',
  }
  if (known[extension]) return known[extension]
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  return 'application/octet-stream'
}

function toReference(file: UserFile): AgentOutputFileReference {
  const base = `/api/v1/agent/files/${file.id}/content`
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? 'application/octet-stream',
    sizeBytes: Number(file.sizeBytes),
    sha256: file.sha256 ?? '',
    path: file.sandboxPath ?? '',
    contentUrl: base,
    downloadUrl: `${base}?download=1`,
  }
}
