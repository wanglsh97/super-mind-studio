import type { AgentSkillCategory } from '@supermind/sdk'

export const SKILL_CATEGORIES = [
  { value: 'development', label: '开发工具' },
  { value: 'data', label: '数据处理' },
  { value: 'research', label: '研究分析' },
  { value: 'content', label: '内容创作' },
  { value: 'productivity', label: '效率自动化' },
  { value: 'other', label: '其他' },
] as const satisfies readonly { value: AgentSkillCategory; label: string }[]

export type SkillCategory = (typeof SKILL_CATEGORIES)[number]['value']

export const MAX_SKILL_PACKAGE_BYTES = 20 * 1024 * 1024
export const SKILL_TITLE_MAX_LENGTH = 60
export const SKILL_DESCRIPTION_MAX_LENGTH = 240

export function validateSkillMetadata(input: {
  name: string
  title: string
  description: string
  category: string
}): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(input.name)) {
    errors.name = '名称须为 1–64 位小写字母、数字或连字符'
  }
  const title = input.title.trim()
  if (!title || title.length > SKILL_TITLE_MAX_LENGTH) {
    errors.title = `标题须为 1–${SKILL_TITLE_MAX_LENGTH} 个字符`
  }
  const description = input.description.trim()
  if (!description || description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    errors.description = `简介须为 1–${SKILL_DESCRIPTION_MAX_LENGTH} 个字符`
  }
  if (!SKILL_CATEGORIES.some((category) => category.value === input.category)) {
    errors.category = '请选择平台分类'
  }
  return errors
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
