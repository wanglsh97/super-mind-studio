import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import type {
  AgentSkillCategory,
  AgentSkillMarketDetail,
  AgentSkillMarketSummary,
} from '@supermind/sdk'

import {
  publicFileTree,
  SkillMarketRepository,
  type PublicSkillMarketRecord,
  type SkillMarketQuery,
  type SkillMarketRepositoryPort,
} from './skill-market.repository'

export interface PublicSkillMarketPage {
  items: AgentSkillMarketSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

@Injectable()
export class SkillMarketService {
  constructor(
    @Inject(SkillMarketRepository)
    private readonly repository: SkillMarketRepositoryPort,
  ) {}

  async list(query: SkillMarketQuery): Promise<PublicSkillMarketPage> {
    const result = await this.repository.listPublished(query)
    return {
      items: result.items.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / query.pageSize),
    }
  }

  async detail(name: string): Promise<AgentSkillMarketDetail> {
    const skill = await this.repository.findPublishedByName(name)
    if (!skill) {
      throw new NotFoundException({
        code: 'SKILL_NOT_FOUND',
        message: 'Skill 不存在或未发布',
        retryable: false,
      })
    }
    return {
      ...toSummary(skill),
      skillMarkdown: skill.skillMarkdown ?? '',
      files: publicFileTree(skill.fileTree),
    }
  }
}

function toSummary(skill: PublicSkillMarketRecord): AgentSkillMarketSummary {
  return {
    id: skill.id,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    category: skill.category as AgentSkillCategory,
    publicationStatus: 'published',
    addState: 'not_added',
    addCount: skill.addCount,
    ownedByCurrentUser: false,
    updatedAt: skill.updatedAt.toISOString(),
  }
}
