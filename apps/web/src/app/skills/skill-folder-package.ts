import { zipSync } from 'fflate'
import { parse } from 'yaml'

import { MAX_SKILL_PACKAGE_BYTES } from './skill-upload-form'

const MAX_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_FILE_COUNT = 2_000
const MAX_DIRECTORY_DEPTH = 20
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export interface SkillFolderFile {
  readonly name: string
  readonly size: number
  readonly webkitRelativePath?: string
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export interface PreparedSkillFolder {
  readonly archive: Blob
  readonly description: string
  readonly fileCount: number
  readonly folderName: string
  readonly name: string
  readonly sourceBytes: number
  readonly title: string
}

interface SkillFrontmatter {
  description: string
  name: string
  title: string
}

export async function prepareSkillFolder(
  selectedFiles: readonly SkillFolderFile[],
): Promise<PreparedSkillFolder> {
  if (selectedFiles.length === 0) throw new Error('请选择包含 SKILL.md 的技能文件夹')
  if (selectedFiles.length > MAX_FILE_COUNT) {
    throw new Error(`技能文件夹最多包含 ${MAX_FILE_COUNT.toLocaleString('en-US')} 个文件`)
  }

  const folderName = selectedFolderName(selectedFiles)
  const entries = selectedFiles.map((file) => ({
    file,
    path: packageRelativePath(file, folderName),
  }))
  const uniquePaths = new Set(entries.map((entry) => entry.path))
  if (uniquePaths.size !== entries.length) throw new Error('技能文件夹包含重复路径')

  let sourceBytes = 0
  for (const entry of entries) {
    if (entry.file.size > MAX_FILE_BYTES) {
      throw new Error(`文件 ${entry.path} 超过 50 MiB`)
    }
    sourceBytes += entry.file.size
    if (sourceBytes > MAX_EXPANDED_BYTES) throw new Error('技能文件夹总大小不能超过 200 MiB')
    if (entry.path.split('/').length - 1 > MAX_DIRECTORY_DEPTH) {
      throw new Error(`文件 ${entry.path} 超过 20 层目录限制`)
    }
  }

  const skillFile = entries.find((entry) => entry.path === 'SKILL.md')
  if (!skillFile) throw new Error('所选文件夹根目录必须包含 SKILL.md')
  const metadata = parseSkillFrontmatter(await skillFile.file.text())

  const archiveEntries: Record<string, Uint8Array> = {}
  for (const entry of entries) {
    archiveEntries[entry.path] = new Uint8Array(await entry.file.arrayBuffer())
  }
  const compressed = zipSync(archiveEntries, { level: 6 })
  if (compressed.byteLength > MAX_SKILL_PACKAGE_BYTES) {
    throw new Error('文件夹压缩后不能超过 20 MiB')
  }

  return {
    archive: new Blob([Uint8Array.from(compressed)], { type: 'application/zip' }),
    description: metadata.description,
    fileCount: entries.length,
    folderName,
    name: metadata.name,
    sourceBytes,
    title: metadata.title,
  }
}

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const normalized = markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    throw new Error('SKILL.md 必须以 YAML frontmatter（---）开头')
  }
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'),
  )
  if (closingIndex < 0) throw new Error('SKILL.md 的 YAML frontmatter 缺少结束标记')

  let document: unknown
  try {
    document = parse(lines.slice(1, closingIndex).join('\n'), { maxAliasCount: 20 })
  } catch {
    try {
      document = parse(normalizeLegacyFrontmatter(lines.slice(1, closingIndex)), {
        maxAliasCount: 20,
      })
    } catch {
      throw new Error('SKILL.md 的 YAML frontmatter 无法解析')
    }
  }
  if (!isRecord(document)) throw new Error('SKILL.md 的 YAML frontmatter 必须是对象')

  const declaredName = typeof document.name === 'string' ? document.name.trim() : ''
  const metadata = isRecord(document.metadata) ? document.metadata : undefined
  const openclaw = metadata && isRecord(metadata.openclaw) ? metadata.openclaw : undefined
  const fallbackName = typeof openclaw?.skillKey === 'string' ? openclaw.skillKey.trim() : ''
  const name = SKILL_NAME_PATTERN.test(declaredName) ? declaredName : fallbackName
  const description = typeof document.description === 'string' ? document.description.trim() : ''
  if (!name) throw new Error('SKILL.md 的 YAML frontmatter 缺少 name')
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      'SKILL.md 的 name 须为 1–64 位小写字母、数字或连字符；中文展示名请设置 metadata.openclaw.skillKey',
    )
  }
  if (!description) throw new Error('SKILL.md 的 YAML frontmatter 缺少 description')

  const displayName = typeof metadata?.displayName === 'string' ? metadata.displayName.trim() : ''
  return { description, name, title: displayName || declaredName || name }
}

/**
 * 一些早期 OpenClaw Skill 把 version / description 误缩进到标量 name 下。
 * 只在严格 YAML 解析失败后处理这两个已知顶级字段，避免容忍任意畸形 YAML。
 */
function normalizeLegacyFrontmatter(lines: readonly string[]): string {
  const nameIndex = lines.findIndex((line) => /^name:\s*\S/.test(line))
  if (nameIndex < 0) return lines.join('\n')
  let repairLegacyRootFields = true
  return lines
    .map((line, index) => {
      if (index <= nameIndex) return line
      if (/^\S/.test(line)) repairLegacyRootFields = false
      return repairLegacyRootFields && /^ {2}(version|description):/.test(line)
        ? line.slice(2)
        : line
    })
    .join('\n')
}

function selectedFolderName(files: readonly SkillFolderFile[]): string {
  const paths = files.map((file) => normalizedInputPath(file))
  const firstSegments = paths.map((path) => path.split('/')[0] ?? '')
  const sharedOuterFolder =
    paths.every((path) => path.includes('/')) &&
    firstSegments.every((segment) => segment === firstSegments[0])
  return sharedOuterFolder ? (firstSegments[0] ?? '') : ''
}

function packageRelativePath(file: SkillFolderFile, folderName: string): string {
  const path = normalizedInputPath(file)
  const relativePath = folderName ? path.slice(folderName.length + 1) : path
  if (!relativePath) throw new Error('技能文件夹包含无效路径')
  return relativePath
}

function normalizedInputPath(file: SkillFolderFile): string {
  const value = (file.webkitRelativePath || file.name).replaceAll('\\', '/')
  const segments = value.split('/')
  if (
    value.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`技能文件夹包含无效路径：${value || file.name}`)
  }
  return segments.join('/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
