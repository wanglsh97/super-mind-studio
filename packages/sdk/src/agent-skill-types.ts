export const AGENT_SKILL_PUBLICATION_STATUSES = [
  'pending_review',
  'published',
  'rejected',
  'delisted',
] as const
export type AgentSkillPublicationStatus = (typeof AGENT_SKILL_PUBLICATION_STATUSES)[number]

export const AGENT_SKILL_ADD_STATES = ['not_added', 'added', 'unavailable'] as const
export type AgentSkillAddState = (typeof AGENT_SKILL_ADD_STATES)[number]

export const AGENT_SKILL_CATEGORIES = [
  'development',
  'data',
  'research',
  'content',
  'productivity',
  'other',
] as const
export type AgentSkillCategory = (typeof AGENT_SKILL_CATEGORIES)[number]

export interface AgentSkillFileEntry {
  path: string
  type: 'file' | 'directory'
  size: number | null
}

/** 已发布 Skill 中单个文件的受限文本预览。 */
export interface AgentSkillFilePreview {
  path: string
  content: string | null
  previewable: boolean
  truncated: boolean
}

/**
 * 公开市场与“我的 Skill”共用的摘要。
 *
 * `addState=unavailable` 仅会出现在当前用户曾添加、但 Skill 已下架或缺失的私有列表中；
 * 公开市场只返回 `published` 项。
 */
export interface AgentSkillMarketSummary {
  id: string
  /** 全局唯一、供 `skill` 和 Run 手动选择使用的稳定名称。 */
  name: string
  title: string
  description: string
  category: AgentSkillCategory
  publicationStatus: AgentSkillPublicationStatus
  addState: AgentSkillAddState
  addCount: number
  ownedByCurrentUser: boolean
  updatedAt: string
}

export interface AgentSkillMarketDetail extends AgentSkillMarketSummary {
  /** 已消毒的 SKILL.md 渲染源；不得包含 OSS 签名地址。 */
  skillMarkdown: string
  /** 只包含路径、类型和大小；文件正文需按路径单独请求预览。 */
  files: AgentSkillFileEntry[]
}

export interface SelectAgentSkill {
  /** 对应 `AgentSkillMarketSummary.name`。 */
  name: string
}

/** 当前用户已添加且仍可用于新 Run 的最小选择器投影。 */
export interface AgentSkillCandidate {
  id: string
  name: string
  title: string
  description: string
}

/**
 * @deprecated 现有内置 Skill API 的过渡契约；上传式市场迁移完成后使用
 * `AgentSkillMarketSummary` / `AgentSkillMarketDetail`。
 */
export interface AgentSkillMarketItem {
  id: string
  name: string
  version: string
  description: string
  category: string
  allowedTools: readonly string[]
  installed: boolean
  enabled: boolean
}

export interface UpdateAgentSkillRequest {
  enabled: boolean
}
