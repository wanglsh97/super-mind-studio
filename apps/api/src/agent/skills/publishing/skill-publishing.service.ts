import { Inject, Injectable } from '@nestjs/common'

import type { AgentSkillCategory } from '@supermind/sdk'

import {
  SkillClaimPersistenceError,
  SkillPublishingRepository,
  type ClaimedSkillRecord,
  type SkillPublishingRepositoryPort,
  type UpdatePublishedSkillInput,
} from './skill-publishing.repository'

export const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
export const SKILL_TITLE_MAX_LENGTH = 60
export const SKILL_DESCRIPTION_MAX_LENGTH = 300
export const SKILL_CATEGORIES = [
  'development',
  'data',
  'research',
  'content',
  'productivity',
  'other',
] as const satisfies readonly AgentSkillCategory[]

export interface SubmitSkillInput {
  uploadSessionId: string
  name: string
  title: string
  description: string
  category: AgentSkillCategory
  iconObjectKey?: string
}

@Injectable()
export class SkillPublishingService {
  constructor(
    @Inject(SkillPublishingRepository)
    private readonly repository: SkillPublishingRepositoryPort,
  ) {}

  async claim(userId: string, input: SubmitSkillInput): Promise<ClaimedSkillRecord> {
    const normalized = validateSubmission(input)
    try {
      return await this.repository.claim({ userId, ...normalized })
    } catch (error) {
      if (error instanceof SkillClaimPersistenceError) {
        throw new SkillPublishingError(error.code, error.message)
      }
      throw error
    }
  }

  async updatePublished(
    userId: string,
    name: string,
    input: Omit<SubmitSkillInput, 'name'>,
  ): Promise<ClaimedSkillRecord> {
    const normalized = validateSubmission({ ...input, name })
    try {
      return await this.repository.updatePublished({
        userId,
        ...normalized,
      } satisfies UpdatePublishedSkillInput)
    } catch (error) {
      if (error instanceof SkillClaimPersistenceError) {
        throw new SkillPublishingError(error.code, error.message)
      }
      throw error
    }
  }

  async delistOwned(userId: string, name: string): Promise<ClaimedSkillRecord> {
    validateName(name)
    try {
      return await this.repository.delistOwned(userId, name, new Date())
    } catch (error) {
      if (error instanceof SkillClaimPersistenceError) {
        throw new SkillPublishingError(error.code, error.message)
      }
      throw error
    }
  }

  listOwned(userId: string): Promise<ClaimedSkillRecord[]> {
    return this.repository.listOwned(userId)
  }

  async requireOwner(userId: string, name: string): Promise<ClaimedSkillRecord> {
    validateName(name)
    const skill = await this.repository.findByName(name)
    if (!skill) throw new SkillPublishingError('SKILL_NOT_FOUND', 'Skill 不存在')
    if (skill.ownerId !== userId) {
      throw new SkillPublishingError('SKILL_NOT_OWNER', '只有 Skill owner 可以覆盖资源包或元数据')
    }
    return skill
  }
}

export class SkillPublishingError extends Error {
  readonly retryable = false

  constructor(
    readonly code:
      | 'SKILL_NAME_INVALID'
      | 'SKILL_CATEGORY_INVALID'
      | 'SKILL_METADATA_INVALID'
      | 'SKILL_NAME_TAKEN'
      | 'SKILL_UPLOAD_NOT_FINALIZED'
      | 'SKILL_UPLOAD_ALREADY_USED'
      | 'SKILL_NOT_FOUND'
      | 'SKILL_NOT_OWNER'
      | 'SKILL_NOT_PUBLISHED'
      | 'SKILL_DELIST_INVALID_TRANSITION',
    message: string,
  ) {
    super(message)
    this.name = 'SkillPublishingError'
  }
}

function validateSubmission(input: SubmitSkillInput): SubmitSkillInput {
  validateName(input.name)
  if (!SKILL_CATEGORIES.includes(input.category)) {
    throw new SkillPublishingError('SKILL_CATEGORY_INVALID', 'Skill 分类不在平台固定枚举中')
  }
  const title = input.title.trim()
  const description = input.description.trim()
  if (
    !title ||
    title.length > SKILL_TITLE_MAX_LENGTH ||
    !description ||
    description.length > SKILL_DESCRIPTION_MAX_LENGTH
  ) {
    throw new SkillPublishingError('SKILL_METADATA_INVALID', 'Skill 标题或描述长度无效')
  }
  return { ...input, title, description }
}

function validateName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new SkillPublishingError(
      'SKILL_NAME_INVALID',
      'Skill 名称须为 1–64 位小写字母、数字或连字符，且首尾不能是连字符',
    )
  }
}
