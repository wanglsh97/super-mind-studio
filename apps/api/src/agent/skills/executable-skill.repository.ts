import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../../database/prisma.service'
import {
  MOCK_EXECUTABLE_SKILL,
  MOCK_EXECUTABLE_SKILL_PACKAGE,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from './executable-skill.fixture'

export interface ExecutableSkillRecord {
  id: string
  name: string
  title: string
  description: string
  status: 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'DELISTED'
  packageObjectKey: string | null
  packageSha256: string | null
}

export interface ExecutableSkillRepositoryPort {
  ensureMockPublishedSkill(): Promise<ExecutableSkillRecord>
  findPublishedByName(name: string): Promise<ExecutableSkillRecord | null>
  findAddedByName(userId: string, name: string): Promise<ExecutableSkillRecord | null>
  findAddedPublishedByName(userId: string, name: string): Promise<ExecutableSkillRecord | null>
  listAddedPublished(userId: string): Promise<ExecutableSkillRecord[]>
  addForUser(userId: string, skill: ExecutableSkillRecord, limit: number): Promise<boolean>
  removeForUser(userId: string, skillId: string): Promise<void>
}

const SKILL_SELECT = {
  id: true,
  name: true,
  title: true,
  description: true,
  status: true,
  packageObjectKey: true,
  packageSha256: true,
} as const

@Injectable()
export class ExecutableSkillRepository implements ExecutableSkillRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureMockPublishedSkill(): Promise<ExecutableSkillRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: {
          authProvider_providerUserId: {
            authProvider: MOCK_EXECUTABLE_SKILL.owner.authProvider,
            providerUserId: MOCK_EXECUTABLE_SKILL.owner.providerUserId,
          },
        },
        create: {
          id: MOCK_EXECUTABLE_SKILL.owner.id,
          authProvider: MOCK_EXECUTABLE_SKILL.owner.authProvider,
          providerUserId: MOCK_EXECUTABLE_SKILL.owner.providerUserId,
          userName: MOCK_EXECUTABLE_SKILL.owner.userName,
          lastLoginAt: new Date(0),
        },
        update: {},
      })
      return tx.skill.upsert({
        where: { name: MOCK_EXECUTABLE_SKILL.name },
        create: {
          id: MOCK_EXECUTABLE_SKILL.id,
          name: MOCK_EXECUTABLE_SKILL.name,
          ownerId: MOCK_EXECUTABLE_SKILL.owner.id,
          title: MOCK_EXECUTABLE_SKILL.title,
          description: MOCK_EXECUTABLE_SKILL.description,
          category: MOCK_EXECUTABLE_SKILL.category,
          status: 'PUBLISHED',
          packageObjectKey: MOCK_EXECUTABLE_SKILL.objectKey,
          packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
          packageSizeBytes: BigInt(MOCK_EXECUTABLE_SKILL_PACKAGE_SIZE),
          skillMarkdown: MOCK_EXECUTABLE_SKILL.skillMarkdown,
          fileTree: [],
          publishedAt: new Date(0),
          packageUpdatedAt: new Date(0),
        },
        update: {
          packageObjectKey: MOCK_EXECUTABLE_SKILL.objectKey,
          packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
          packageSizeBytes: BigInt(MOCK_EXECUTABLE_SKILL_PACKAGE.archive.byteLength),
          skillMarkdown: MOCK_EXECUTABLE_SKILL.skillMarkdown,
          fileTree: MOCK_EXECUTABLE_SKILL_PACKAGE.files,
          packageUpdatedAt: new Date(0),
        },
        select: SKILL_SELECT,
      })
    })
  }

  async findPublishedByName(name: string): Promise<ExecutableSkillRecord | null> {
    return this.prisma.skill.findFirst({
      where: { name, status: 'PUBLISHED' },
      select: SKILL_SELECT,
    })
  }

  async findAddedPublishedByName(
    userId: string,
    name: string,
  ): Promise<ExecutableSkillRecord | null> {
    const row = await this.prisma.userAgentSkill.findFirst({
      where: { userId, marketSkill: { name, status: 'PUBLISHED' } },
      select: { marketSkill: { select: SKILL_SELECT } },
    })
    return row?.marketSkill ?? null
  }

  async findAddedByName(userId: string, name: string): Promise<ExecutableSkillRecord | null> {
    const row = await this.prisma.userAgentSkill.findFirst({
      where: { userId, marketSkill: { name } },
      select: { marketSkill: { select: SKILL_SELECT } },
    })
    return row?.marketSkill ?? null
  }

  async listAddedPublished(userId: string): Promise<ExecutableSkillRecord[]> {
    const rows = await this.prisma.userAgentSkill.findMany({
      where: { userId, marketSkill: { status: 'PUBLISHED' } },
      select: { marketSkill: { select: SKILL_SELECT } },
      orderBy: { marketSkill: { name: 'asc' } },
    })
    return rows.flatMap((row) => (row.marketSkill ? [row.marketSkill] : []))
  }

  async addForUser(userId: string, skill: ExecutableSkillRecord, limit: number): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`
            const existing = await tx.userAgentSkill.findUnique({
              where: { userId_marketSkillId: { userId, marketSkillId: skill.id } },
              select: { id: true },
            })
            if (existing) return false
            const count = await tx.userAgentSkill.count({
              where: { userId, marketSkillId: { not: null } },
            })
            if (count >= limit) throw new AgentSkillAddLimitError(limit)
            await tx.userAgentSkill.create({
              data: {
                userId,
                skillId: skill.name,
                marketSkillId: skill.id,
              },
            })
            await tx.skill.update({
              where: { id: skill.id },
              data: { addCount: { increment: 1 } },
            })
            return true
          },
          { isolationLevel: 'Serializable' },
        )
      } catch (error) {
        if (isUniqueConflict(error)) return false
        if (isSerializationConflict(error) && attempt < 2) continue
        throw error
      }
    }
    throw new Error('Skill add retry boundary exhausted')
  }

  async removeForUser(userId: string, skillId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`
      const deleted = await tx.userAgentSkill.deleteMany({
        where: { userId, marketSkillId: skillId },
      })
      if (deleted.count > 0) {
        await tx.skill.update({
          where: { id: skillId },
          data: { addCount: { decrement: 1 } },
        })
      }
    })
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  )
}

const MOCK_EXECUTABLE_SKILL_PACKAGE_SIZE = MOCK_EXECUTABLE_SKILL_PACKAGE.archive.byteLength

export class AgentSkillAddLimitError extends Error {
  constructor(readonly limit: number) {
    super(`每位用户最多添加 ${limit} 个 Skill`)
    this.name = 'AgentSkillAddLimitError'
  }
}
