import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

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
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../storage/skill-object-store.port'

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
    @Inject(SKILL_OBJECT_STORE_PORT)
    private readonly objects: SkillObjectStorePort,
  ) {}

  async list(query: SkillMarketQuery): Promise<PublicSkillMarketPage> {
    const normalizedQuery = {
      ...query,
      page: paginationInteger(query.page, 'page'),
      pageSize: paginationInteger(query.pageSize, 'pageSize', 50),
    }
    const result = await this.repository.listPublished(normalizedQuery)
    return {
      items: result.items.map(toSummary),
      page: normalizedQuery.page,
      pageSize: normalizedQuery.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / normalizedQuery.pageSize),
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
    const storedPackage = await this.loadPackageProjection(skill.packageObjectKey)
    const persistedFiles = publicFileTree(skill.fileTree)
    return {
      ...toSummary(skill),
      skillMarkdown: skill.skillMarkdown || storedPackage?.skillMarkdown || '',
      files: persistedFiles.length > 0 ? persistedFiles : (storedPackage?.files ?? []),
    }
  }

  private async loadPackageProjection(objectKey: string | null) {
    if (!objectKey) return null
    try {
      return await this.objects.loadSkillPackage(objectKey)
    } catch {
      // 历史记录可能没有可访问的对象包；详情仍应返回已持久化的安全投影。
      return null
    }
  }
}

function paginationInteger(value: unknown, field: 'page' | 'pageSize', max?: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new BadRequestException({
      code: 'INVALID_REQUEST',
      message: `${field} 必须是${max === undefined ? '正整数' : `1 到 ${max} 之间的整数`}`,
      retryable: false,
    })
  }
  return parsed
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
