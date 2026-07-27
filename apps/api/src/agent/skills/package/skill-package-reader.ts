import type { Entry, ZipFile } from 'yauzl'
import { fromBuffer } from 'yauzl'

import type { AgentSkillFileEntry } from '@supermind/sdk'

import {
  SkillZipInspectionError,
  SkillZipInspector,
  type InspectedSkillZip,
} from './skill-zip-inspector'

export const DEFAULT_SKILL_MARKDOWN_MAX_BYTES = 1024 * 1024

export type SkillPackageReadErrorCode =
  'SKILL_MD_SIZE_LIMIT' | 'SKILL_MD_INVALID_UTF8' | 'SKILL_MD_BINARY' | 'SKILL_MD_EMPTY'

export class SkillPackageReadError extends Error {
  constructor(
    readonly code: SkillPackageReadErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SkillPackageReadError'
  }
}

export interface SkillPackageProjection {
  compressedSizeBytes: number
  expandedSizeBytes: number
  fileCount: number
  skillMarkdown: string
  files: AgentSkillFileEntry[]
}

export class SkillPackageReader {
  constructor(
    private readonly inspector = new SkillZipInspector(),
    private readonly maxSkillMarkdownBytes = DEFAULT_SKILL_MARKDOWN_MAX_BYTES,
  ) {}

  async read(archive: Uint8Array): Promise<SkillPackageProjection> {
    const inspection = await this.inspector.inspect(archive)
    const skillMarkdownBytes = await readRootSkillMarkdown(
      Buffer.from(archive),
      this.maxSkillMarkdownBytes,
    )
    const skillMarkdown = sanitizeSkillMarkdown(decodeSkillMarkdown(skillMarkdownBytes))
    if (!skillMarkdown.trim()) {
      throw new SkillPackageReadError('SKILL_MD_EMPTY', 'SKILL.md 消毒后不能为空')
    }
    return projectPackage(inspection, skillMarkdown)
  }
}

export function sanitizeSkillMarkdown(markdown: string): string {
  const withoutHtml = stripRawHtml(markdown.replace(/\r\n?/g, '\n'))
  return sanitizeReferenceLinks(sanitizeInlineLinks(withoutHtml))
}

export function safeSkillMarkdownUrl(value: string): string {
  const normalized = [...decodeHtmlEntities(value.trim())]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127 && !/\s/.test(character)
    })
    .join('')
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase()
  if (protocol && !['http', 'https', 'mailto'].includes(protocol)) return ''
  return value
}

function projectPackage(
  inspection: InspectedSkillZip,
  skillMarkdown: string,
): SkillPackageProjection {
  return {
    compressedSizeBytes: inspection.compressedSizeBytes,
    expandedSizeBytes: inspection.expandedSizeBytes,
    fileCount: inspection.fileCount,
    skillMarkdown,
    files: inspection.files.map((file) => ({ ...file })),
  }
}

function decodeSkillMarkdown(bytes: Buffer): string {
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SkillPackageReadError('SKILL_MD_INVALID_UTF8', 'SKILL.md 必须是有效的 UTF-8 文本')
  }
  if (hasBinaryControls(value)) {
    throw new SkillPackageReadError('SKILL_MD_BINARY', 'SKILL.md 不能包含二进制控制字符')
  }
  return value
}

function hasBinaryControls(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true
  }
  return false
}

function stripRawHtml(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(script|style|iframe|object|embed|template|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<[^>]*>/g, '')
}

function sanitizeInlineLinks(markdown: string): string {
  return markdown.replace(
    /(!?\[[^\]\n]*\]\(\s*)(<?)([^)\n]*?)(>?)(\))/g,
    (match, prefix: string, opening: string, body: string, closing: string, suffix: string) => {
      const { destination, remainder } = splitLinkDestination(body)
      if (safeSkillMarkdownUrl(destination)) return match
      return `${prefix}${opening}${remainder.trimStart()}${closing}${suffix}`
    },
  )
}

function sanitizeReferenceLinks(markdown: string): string {
  return markdown.replace(
    /^(\s{0,3}\[[^\]\n]+\]:\s*)(<?)(\S+?)(>?)([ \t].*)?$/gm,
    (match, prefix: string, opening: string, destination: string, closing: string, suffix = '') => {
      if (safeSkillMarkdownUrl(destination)) return match
      return `${prefix}${opening}${closing}${suffix}`
    },
  )
}

function splitLinkDestination(body: string): { destination: string; remainder: string } {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('<')) {
    const closeIndex = trimmed.indexOf('>')
    if (closeIndex !== -1) {
      return {
        destination: trimmed.slice(1, closeIndex),
        remainder: trimmed.slice(closeIndex + 1),
      }
    }
  }
  const whitespaceIndex = trimmed.search(/\s/)
  if (whitespaceIndex === -1) return { destination: trimmed, remainder: '' }
  return {
    destination: trimmed.slice(0, whitespaceIndex),
    remainder: trimmed.slice(whitespaceIndex),
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (entity: string, digits: string) =>
      decodeCodePointEntity(entity, digits, 10),
    )
    .replace(/&#x([\da-f]+);?/gi, (entity: string, digits: string) =>
      decodeCodePointEntity(entity, digits, 16),
    )
    .replace(/&colon;?/gi, ':')
    .replace(/&(tab|newline);?/gi, (_, name: string) =>
      name.toLowerCase() === 'tab' ? '\t' : '\n',
    )
}

function decodeCodePointEntity(entity: string, digits: string, radix: number): string {
  const codePoint = Number.parseInt(digits, radix)
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return entity
  }
  return String.fromCodePoint(codePoint)
}

async function readRootSkillMarkdown(buffer: Buffer, maxBytes: number): Promise<Buffer> {
  const zip = await openZip(buffer)
  return new Promise((resolve, reject) => {
    let settled = false

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      zip.close()
      reject(
        error instanceof SkillPackageReadError || error instanceof SkillZipInspectionError
          ? error
          : new SkillZipInspectionError(
              'ZIP_INVALID',
              error instanceof Error ? error.message : 'Skill ZIP 无法读取',
            ),
      )
    }
    const succeed = (value: Buffer) => {
      if (settled) return
      settled = true
      zip.close()
      resolve(value)
    }

    zip.on('error', fail)
    zip.on('entry', (entry: Entry) => {
      if (entry.fileName !== 'SKILL.md') {
        zip.readEntry()
        return
      }
      if (entry.uncompressedSize > maxBytes) {
        fail(new SkillPackageReadError('SKILL_MD_SIZE_LIMIT', `SKILL.md 不能超过 ${maxBytes} 字节`))
        return
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(error)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > maxBytes) {
            stream.destroy(
              new SkillPackageReadError(
                'SKILL_MD_SIZE_LIMIT',
                `SKILL.md 不能超过 ${maxBytes} 字节`,
              ),
            )
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        stream.on('error', fail)
        stream.on('end', () => succeed(Buffer.concat(chunks, size)))
      })
    })
    zip.on('end', () =>
      fail(new SkillZipInspectionError('ZIP_SKILL_MD_MISSING', 'Skill ZIP 根目录缺少 SKILL.md')),
    )
    zip.readEntry()
  })
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
          reject(new SkillZipInspectionError('ZIP_INVALID', error.message))
          return
        }
        resolve(zip)
      },
    )
  })
}
