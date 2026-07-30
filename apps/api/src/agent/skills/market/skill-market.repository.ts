import { Inject, Injectable } from '@nestjs/common'

import type { AgentSkillCategory, AgentSkillFileEntry } from '@supermind/sdk'

import { PrismaService } from '../../../database/prisma.service'

export interface SkillMarketQuery {
  page: number
  pageSize: number
  keyword?: string
  category?: AgentSkillCategory
  sort: 'latest' | 'popular'
}

export interface PublicSkillMarketRecord {
  id: string
  name: string
  title: string
  description: string
  category: string
  addCount: number
  updatedAt: Date
  packageObjectKey: string | null
  skillMarkdown: string | null
  fileTree: unknown
}

export interface SkillMarketPageRecord {
  items: PublicSkillMarketRecord[]
  total: number
}

export interface SkillMarketRepositoryPort {
  listPublished(query: SkillMarketQuery): Promise<SkillMarketPageRecord>
  findPublishedByName(name: string): Promise<PublicSkillMarketRecord | null>
}

const PUBLIC_SKILL_SELECT = {
  id: true,
  name: true,
  title: true,
  description: true,
  category: true,
  addCount: true,
  updatedAt: true,
  packageObjectKey: true,
  skillMarkdown: true,
  fileTree: true,
} as const

@Injectable()
export class SkillMarketRepository implements SkillMarketRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPublished(query: SkillMarketQuery): Promise<SkillMarketPageRecord> {
    const keyword = query.keyword?.trim()
    const where = {
      status: 'PUBLISHED' as const,
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(!keyword
        ? {}
        : {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' as const } },
              { title: { contains: keyword, mode: 'insensitive' as const } },
              { description: { contains: keyword, mode: 'insensitive' as const } },
              {
                owner: {
                  is: {
                    userName: { contains: keyword, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }),
    }
    const orderBy =
      query.sort === 'popular'
        ? [{ addCount: 'desc' as const }, { publishedAt: 'desc' as const }, { id: 'asc' as const }]
        : [{ publishedAt: 'desc' as const }, { id: 'asc' as const }]
    const [items, total] = await this.prisma.$transaction([
      this.prisma.skill.findMany({
        where,
        select: PUBLIC_SKILL_SELECT,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.skill.count({ where }),
    ])
    return { items, total }
  }

  findPublishedByName(name: string): Promise<PublicSkillMarketRecord | null> {
    return this.prisma.skill.findFirst({
      where: { name, status: 'PUBLISHED' },
      select: PUBLIC_SKILL_SELECT,
    })
  }
}

export function publicFileTree(value: unknown): AgentSkillFileEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('path' in entry) ||
      typeof entry.path !== 'string' ||
      !('type' in entry) ||
      (entry.type !== 'file' && entry.type !== 'directory') ||
      !('size' in entry) ||
      (entry.size !== null && typeof entry.size !== 'number')
    ) {
      return []
    }
    return [{ path: entry.path, type: entry.type, size: entry.size }]
  })
}
