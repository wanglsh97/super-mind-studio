import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const WEBSITE_BUILDING_SKILL = Symbol('WEBSITE_BUILDING_SKILL')
export const WEBSITE_BUILDING_SKILL_NAME = 'website-building'

const REQUIRED_FILES = ['SKILL.md', 'scripts/init.sh', 'scripts/package.py'] as const
const MAX_SKILL_BYTES = 64 * 1024
const MAX_SCRIPT_BYTES = 128 * 1024

export interface WebsiteBuildingSkillFile {
  path: (typeof REQUIRED_FILES)[number]
  bytes: Uint8Array
}

export interface WebsiteBuildingSkill {
  name: typeof WEBSITE_BUILDING_SKILL_NAME
  description: string
  instructions: string
  skillMarkdown: string
  sha256: string
  files: readonly WebsiteBuildingSkillFile[]
}

export function loadWebsiteBuildingSkill(root = resolveWebsiteBuildingSkillRoot()): WebsiteBuildingSkill {
  const files = REQUIRED_FILES.map((path) => {
    const bytes = readBoundedFile(
      resolve(root, path),
      path === 'SKILL.md' ? MAX_SKILL_BYTES : MAX_SCRIPT_BYTES,
    )
    return { path, bytes: Uint8Array.from(bytes) }
  })
  const skillFile = files.find((file) => file.path === 'SKILL.md')
  if (!skillFile) throw new Error('Built-in Skill SKILL.md is missing')
  const skillMarkdown = decodeUtf8(skillFile.bytes, 'SKILL.md')
  const parsed = parseSkillMarkdown(skillMarkdown)
  if (parsed.name !== WEBSITE_BUILDING_SKILL_NAME) {
    throw new Error(
      `Built-in Skill name must be ${WEBSITE_BUILDING_SKILL_NAME}, received ${parsed.name}`,
    )
  }
  const sha256 = createHash('sha256')
  for (const file of files) {
    sha256.update(file.path).update('\0').update(file.bytes).update('\0')
  }
  return Object.freeze({
    name: WEBSITE_BUILDING_SKILL_NAME,
    description: parsed.description,
    instructions: parsed.instructions,
    skillMarkdown,
    sha256: sha256.digest('hex'),
    files: Object.freeze(files),
  })
}

export function renderWebsiteBuildingSkill(skill: WebsiteBuildingSkill): string {
  return [
    `<built_in_skill id="${skill.name}" sha256="${skill.sha256}">`,
    skill.instructions,
    '</built_in_skill>',
  ].join('\n')
}

function resolveWebsiteBuildingSkillRoot(): string {
  const root = resolve(__dirname, '../../../../skills', WEBSITE_BUILDING_SKILL_NAME)
  if (!existsSync(root)) throw new Error(`Built-in Skill directory is missing: ${root}`)
  return root
}

function readBoundedFile(path: string, maxBytes: number): Buffer {
  const bytes = readFileSync(path)
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error(`Built-in Skill file size is invalid: ${path}`)
  }
  return bytes
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n')
  } catch {
    throw new Error(`Built-in Skill file must be UTF-8: ${path}`)
  }
}

function parseSkillMarkdown(markdown: string): {
  name: string
  description: string
  instructions: string
} {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/.exec(markdown)
  if (!match) throw new Error('Built-in Skill SKILL.md must contain YAML frontmatter')
  const metadata = new Map<string, string>()
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error(`Invalid built-in Skill frontmatter line: ${line}`)
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!['name', 'description'].includes(key) || !value || metadata.has(key)) {
      throw new Error(`Invalid built-in Skill frontmatter field: ${key}`)
    }
    metadata.set(key, value)
  }
  const name = metadata.get('name')
  const description = metadata.get('description')
  const instructions = match[2]!.trim()
  if (!name || !description || !instructions) {
    throw new Error('Built-in Skill SKILL.md requires name, description and instructions')
  }
  return { name, description, instructions }
}
