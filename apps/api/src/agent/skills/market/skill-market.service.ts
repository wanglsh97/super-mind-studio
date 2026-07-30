import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import type {
  AgentSkillCategory,
  AgentSkillFilePreview,
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
import { readSkillPackageFiles } from '../package/skill-package-files'

export interface PublicSkillMarketPage {
  items: AgentSkillMarketSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const MAX_FILE_PREVIEW_BYTES = 256 * 1024

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

  async filePreview(name: string, path: string): Promise<AgentSkillFilePreview> {
    const skill = await this.repository.findPublishedByName(name)
    if (!skill) throw skillNotFound()
    const normalizedPath = normalizeFilePath(path)
    const storedPackage = await this.loadPackageProjection(skill.packageObjectKey)
    if (
      !storedPackage ||
      !storedPackage.files.some((file) => file.type === 'file' && file.path === normalizedPath)
    ) {
      throw new NotFoundException({
        code: 'SKILL_FILE_NOT_FOUND',
        message: 'Skill 文件不存在或暂不可预览',
        retryable: false,
      })
    }
    const file = (await readSkillPackageFiles(storedPackage.archive)).find(
      (candidate) => candidate.path === normalizedPath,
    )
    if (!file) {
      throw new NotFoundException({
        code: 'SKILL_FILE_NOT_FOUND',
        message: 'Skill 文件不存在或暂不可预览',
        retryable: false,
      })
    }
    const preview = textPreview(file.bytes)
    return { path: normalizedPath, ...preview }
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

function skillNotFound() {
  return new NotFoundException({
    code: 'SKILL_NOT_FOUND',
    message: 'Skill 不存在或未发布',
    retryable: false,
  })
}

function normalizeFilePath(path: string) {
  const normalized = path.trim().replaceAll('\\', '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new BadRequestException({
      code: 'SKILL_FILE_PATH_INVALID',
      message: 'Skill 文件路径无效',
      retryable: false,
    })
  }
  return normalized
}

function textPreview(bytes: Uint8Array): Omit<AgentSkillFilePreview, 'path'> {
  const truncated = bytes.byteLength > MAX_FILE_PREVIEW_BYTES
  const slice = bytes.slice(0, MAX_FILE_PREVIEW_BYTES)
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(slice)
  } catch {
    return { content: null, previewable: false, truncated: false }
  }
  if (
    [...content].some((character) => {
      const code = character.charCodeAt(0)
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
    })
  ) {
    return { content: null, previewable: false, truncated: false }
  }
  return { content, previewable: true, truncated }
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
