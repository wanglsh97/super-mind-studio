import type { Entry, ZipFile } from 'yauzl'
import { fromBuffer } from 'yauzl'

import type { AgentSkillFileEntry } from '@supermind/sdk'

export interface SkillZipLimits {
  maxCompressedBytes: number
  maxExpandedBytes: number
  maxEntries: number
  maxFileBytes: number
  maxDirectoryDepth: number
}

export const DEFAULT_SKILL_ZIP_LIMITS: Readonly<SkillZipLimits> = Object.freeze({
  maxCompressedBytes: 20 * 1024 * 1024,
  maxExpandedBytes: 200 * 1024 * 1024,
  maxEntries: 2_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxDirectoryDepth: 20,
})

export interface InspectedSkillZip {
  compressedSizeBytes: number
  expandedSizeBytes: number
  fileCount: number
  files: AgentSkillFileEntry[]
}

export type SkillZipInspectionErrorCode =
  | 'ZIP_COMPRESSED_SIZE_LIMIT'
  | 'ZIP_EXPANDED_SIZE_LIMIT'
  | 'ZIP_ENTRY_LIMIT'
  | 'ZIP_FILE_SIZE_LIMIT'
  | 'ZIP_DIRECTORY_DEPTH_LIMIT'
  | 'ZIP_PATH_INVALID'
  | 'ZIP_DUPLICATE_PATH'
  | 'ZIP_LINK_NOT_ALLOWED'
  | 'ZIP_ENCRYPTED_NOT_ALLOWED'
  | 'ZIP_SKILL_MD_MISSING'
  | 'ZIP_INVALID'

export class SkillZipInspectionError extends Error {
  constructor(
    readonly code: SkillZipInspectionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SkillZipInspectionError'
  }
}

export class SkillZipInspector {
  constructor(private readonly limits: SkillZipLimits = DEFAULT_SKILL_ZIP_LIMITS) {}

  async inspect(archive: Uint8Array): Promise<InspectedSkillZip> {
    if (archive.byteLength > this.limits.maxCompressedBytes) {
      throw new SkillZipInspectionError(
        'ZIP_COMPRESSED_SIZE_LIMIT',
        `Skill ZIP 压缩大小不能超过 ${this.limits.maxCompressedBytes} 字节`,
      )
    }
    const zip = await openZip(Buffer.from(archive))
    try {
      if (zip.entryCount > this.limits.maxEntries) {
        throw new SkillZipInspectionError(
          'ZIP_ENTRY_LIMIT',
          `Skill ZIP 条目数不能超过 ${this.limits.maxEntries}`,
        )
      }
      return await this.inspectEntries(zip, archive.byteLength)
    } catch (error) {
      zip.close()
      if (error instanceof SkillZipInspectionError) throw error
      throw normalizeZipError(error)
    }
  }

  private inspectEntries(zip: ZipFile, compressedSizeBytes: number): Promise<InspectedSkillZip> {
    return new Promise((resolve, reject) => {
      const files: AgentSkillFileEntry[] = []
      const paths = new Set<string>()
      const localHeaderOffsets = new Set<number>()
      let expandedSizeBytes = 0
      let fileCount = 0
      let hasRootSkillMarkdown = false

      const fail = (error: unknown) => {
        zip.close()
        reject(error)
      }

      zip.on('error', fail)
      zip.on('entry', (entry: Entry) => {
        try {
          const inspected = inspectEntry(entry, this.limits, paths, localHeaderOffsets)
          if (inspected.type === 'file') {
            fileCount += 1
            expandedSizeBytes += inspected.size ?? 0
            if (fileCount > this.limits.maxEntries) {
              throw new SkillZipInspectionError(
                'ZIP_ENTRY_LIMIT',
                `Skill ZIP 文件数不能超过 ${this.limits.maxEntries}`,
              )
            }
            if (expandedSizeBytes > this.limits.maxExpandedBytes) {
              throw new SkillZipInspectionError(
                'ZIP_EXPANDED_SIZE_LIMIT',
                `Skill ZIP 解压总大小不能超过 ${this.limits.maxExpandedBytes} 字节`,
              )
            }
            if (inspected.path === 'SKILL.md') hasRootSkillMarkdown = true
          }
          files.push(inspected)
          zip.readEntry()
        } catch (error) {
          fail(error)
        }
      })
      zip.on('end', () => {
        if (!hasRootSkillMarkdown) {
          reject(
            new SkillZipInspectionError(
              'ZIP_SKILL_MD_MISSING',
              'Skill ZIP 根目录必须包含大小写精确的 SKILL.md',
            ),
          )
          return
        }
        resolve({
          compressedSizeBytes,
          expandedSizeBytes,
          fileCount,
          files: files.sort((left, right) => left.path.localeCompare(right.path)),
        })
      })
      zip.readEntry()
    })
  }
}

export function inspectEntry(
  entry: Pick<
    Entry,
    | 'fileName'
    | 'uncompressedSize'
    | 'externalFileAttributes'
    | 'versionMadeBy'
    | 'relativeOffsetOfLocalHeader'
    | 'extraFields'
    | 'isEncrypted'
  >,
  limits: SkillZipLimits = DEFAULT_SKILL_ZIP_LIMITS,
  paths: Set<string> = new Set(),
  localHeaderOffsets: Set<number> = new Set(),
): AgentSkillFileEntry {
  if (entry.isEncrypted()) {
    throw new SkillZipInspectionError('ZIP_ENCRYPTED_NOT_ALLOWED', 'Skill ZIP 不允许加密条目')
  }
  const path = normalizePath(entry.fileName)
  if (paths.has(path)) {
    throw new SkillZipInspectionError('ZIP_DUPLICATE_PATH', `Skill ZIP 包含重复路径: ${path}`)
  }
  paths.add(path)

  if (localHeaderOffsets.has(entry.relativeOffsetOfLocalHeader)) {
    throw new SkillZipInspectionError(
      'ZIP_LINK_NOT_ALLOWED',
      `Skill ZIP 条目复用了 local header，疑似硬链接: ${path}`,
    )
  }
  localHeaderOffsets.add(entry.relativeOffsetOfLocalHeader)
  assertNoLinks(entry, path)

  const isDirectory = entry.fileName.endsWith('/')
  const segments = path.split('/')
  const directoryDepth = isDirectory ? segments.length : segments.length - 1
  if (directoryDepth > limits.maxDirectoryDepth) {
    throw new SkillZipInspectionError(
      'ZIP_DIRECTORY_DEPTH_LIMIT',
      `Skill ZIP 路径目录深度不能超过 ${limits.maxDirectoryDepth}: ${path}`,
    )
  }
  if (!isDirectory && entry.uncompressedSize > limits.maxFileBytes) {
    throw new SkillZipInspectionError(
      'ZIP_FILE_SIZE_LIMIT',
      `Skill ZIP 单文件不能超过 ${limits.maxFileBytes} 字节: ${path}`,
    )
  }
  if (isDirectory && entry.uncompressedSize !== 0) {
    throw new SkillZipInspectionError('ZIP_INVALID', `目录条目大小必须为 0: ${path}`)
  }
  return {
    path,
    type: isDirectory ? 'directory' : 'file',
    size: isDirectory ? null : entry.uncompressedSize,
  }
}

function normalizePath(value: string): string {
  const withoutSlash = value.endsWith('/') ? value.slice(0, -1) : value
  const segments = withoutSlash.split('/')
  if (
    !withoutSlash ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes('\uFFFD') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new SkillZipInspectionError('ZIP_PATH_INVALID', `Skill ZIP 路径无效: ${value}`)
  }
  return withoutSlash
}

function assertNoLinks(
  entry: Pick<Entry, 'versionMadeBy' | 'externalFileAttributes' | 'extraFields'>,
  path: string,
): void {
  const platform = entry.versionMadeBy >>> 8
  if (platform === 3) {
    const mode = (entry.externalFileAttributes >>> 16) & 0xffff
    const fileType = mode & 0o170000
    if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
      throw new SkillZipInspectionError(
        'ZIP_LINK_NOT_ALLOWED',
        `Skill ZIP 不允许符号链接、硬链接或设备条目: ${path}`,
      )
    }
  }
  if (entry.extraFields.some((field) => field.id === 0x000d || field.id === 0x756e)) {
    throw new SkillZipInspectionError(
      'ZIP_LINK_NOT_ALLOWED',
      `Skill ZIP 不允许 Unix link extra field: ${path}`,
    )
  }
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      buffer,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zip) => {
        if (error) {
          reject(normalizeZipError(error))
          return
        }
        resolve(zip)
      },
    )
  })
}

function normalizeZipError(error: unknown): SkillZipInspectionError {
  const message = error instanceof Error ? error.message : 'Skill ZIP 无法解析'
  if (/invalid relative path|absolute path|backslash/i.test(message)) {
    return new SkillZipInspectionError('ZIP_PATH_INVALID', message)
  }
  return new SkillZipInspectionError('ZIP_INVALID', message)
}
