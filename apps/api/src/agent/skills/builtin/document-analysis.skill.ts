import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DOCUMENT_ANALYSIS_SKILL = Symbol('DOCUMENT_ANALYSIS_SKILL')
export const DOCUMENT_ANALYSIS_SKILL_NAME = 'document-analysis'

export interface DocumentAnalysisSkill {
  name: typeof DOCUMENT_ANALYSIS_SKILL_NAME
  description: string
  instructions: string
  skillMarkdown: string
}

export function loadDocumentAnalysisSkill(root = resolveDocumentAnalysisSkillRoot()): DocumentAnalysisSkill {
  const path = resolve(root, 'SKILL.md')
  if (!existsSync(path)) throw new Error(`Built-in Skill file is missing: ${path}`)
  const skillMarkdown = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/.exec(skillMarkdown)
  if (!match) throw new Error('Built-in document Skill SKILL.md must contain frontmatter')
  const metadata = new Map<string, string>()
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error(`Invalid document Skill frontmatter line: ${line}`)
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const name = metadata.get('name')
  const description = metadata.get('description')
  const instructions = match[2]!.trim()
  if (name !== DOCUMENT_ANALYSIS_SKILL_NAME || !description || !instructions) {
    throw new Error(`Built-in Skill name must be ${DOCUMENT_ANALYSIS_SKILL_NAME}`)
  }
  return Object.freeze({ name, description, instructions, skillMarkdown })
}

export function renderDocumentAnalysisSkill(skill: DocumentAnalysisSkill): string {
  return `<built_in_skill id="${skill.name}">\n${skill.instructions}\n</built_in_skill>`
}

function resolveDocumentAnalysisSkillRoot(): string {
  const root = resolve(__dirname, '../../../../skills', DOCUMENT_ANALYSIS_SKILL_NAME)
  if (!existsSync(root)) throw new Error(`Built-in Skill directory is missing: ${root}`)
  return root
}
