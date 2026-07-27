import { Inject, Injectable } from '@nestjs/common'

import type { AgentSkillCategory } from '@supermind/sdk'

import { PrismaService } from '../../../database/prisma.service'

export interface ClaimSkillInput {
  userId: string
  uploadSessionId: string
  name: string
  title: string
  description: string
  category: AgentSkillCategory
  iconObjectKey?: string
}

export interface UpdatePublishedSkillInput extends Omit<ClaimSkillInput, 'userId' | 'name'> {
  userId: string
  name: string
}

export interface ClaimedSkillRecord {
  id: string
  name: string
  ownerId: string
  title: string
  description: string
  category: string
  status: 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'DELISTED'
  packageObjectKey: string | null
  packageSha256: string | null
  packageSizeBytes: bigint | null
}

export interface SkillPublishingRepositoryPort {
  claim(input: ClaimSkillInput): Promise<ClaimedSkillRecord>
  updatePublished(input: UpdatePublishedSkillInput): Promise<ClaimedSkillRecord>
  delistOwned(userId: string, name: string, now: Date): Promise<ClaimedSkillRecord>
  listOwned(userId: string): Promise<ClaimedSkillRecord[]>
  findByName(name: string): Promise<ClaimedSkillRecord | null>
}

const CLAIMED_SKILL_SELECT = {
  id: true,
  name: true,
  ownerId: true,
  title: true,
  description: true,
  category: true,
  status: true,
  packageObjectKey: true,
  packageSha256: true,
  packageSizeBytes: true,
} as const

@Injectable()
export class SkillPublishingRepository implements SkillPublishingRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async claim(input: ClaimSkillInput): Promise<ClaimedSkillRecord> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const upload = await tx.skillUploadSession.findFirst({
              where: {
                id: input.uploadSessionId,
                userId: input.userId,
                status: 'FINALIZED',
                skillId: null,
              },
            })
            if (
              !upload ||
              upload.observedSizeBytes === null ||
              upload.observedSha256 === null ||
              upload.finalizedAt === null
            ) {
              throw new SkillClaimPersistenceError(
                'SKILL_UPLOAD_NOT_FINALIZED',
                '上传会话不存在、未完成或已被使用',
              )
            }
            const skill = await tx.skill.create({
              data: {
                name: input.name,
                ownerId: input.userId,
                title: input.title,
                description: input.description,
                category: input.category,
                status: 'PENDING_REVIEW',
                ...(input.iconObjectKey === undefined
                  ? {}
                  : { iconObjectKey: input.iconObjectKey }),
                packageObjectKey: upload.objectKey,
                packageSha256: upload.observedSha256,
                packageSizeBytes: upload.observedSizeBytes,
                packageUpdatedAt: upload.finalizedAt,
              },
              select: CLAIMED_SKILL_SELECT,
            })
            const consumed = await tx.skillUploadSession.updateMany({
              where: { id: upload.id, userId: input.userId, skillId: null },
              data: { skillId: skill.id },
            })
            if (consumed.count !== 1) {
              throw new SkillClaimPersistenceError(
                'SKILL_UPLOAD_ALREADY_USED',
                '上传会话已被其他发布请求使用',
              )
            }
            return skill
          },
          { isolationLevel: 'Serializable' },
        )
      } catch (error) {
        if (error instanceof SkillClaimPersistenceError) throw error
        if (isUniqueConflict(error)) {
          throw new SkillClaimPersistenceError('SKILL_NAME_TAKEN', 'Skill 全局名称已被占用')
        }
        if (isSerializationConflict(error) && attempt === 0) continue
        throw error
      }
    }
    throw new Error('Skill claim retry boundary exhausted')
  }

  async updatePublished(input: UpdatePublishedSkillInput): Promise<ClaimedSkillRecord> {
    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.skill.findUnique({
        where: { name: input.name },
        select: CLAIMED_SKILL_SELECT,
      })
      if (!skill) {
        throw new SkillClaimPersistenceError('SKILL_NOT_FOUND', 'Skill 不存在')
      }
      if (skill.ownerId !== input.userId) {
        throw new SkillClaimPersistenceError('SKILL_NOT_OWNER', '只有 Skill owner 可以更新')
      }
      if (skill.status !== 'PUBLISHED' || !skill.packageObjectKey) {
        throw new SkillClaimPersistenceError(
          'SKILL_NOT_PUBLISHED',
          '只有已发布的 Skill 可以直接覆盖',
        )
      }
      const upload = await tx.skillUploadSession.findFirst({
        where: {
          id: input.uploadSessionId,
          userId: input.userId,
          skillId: skill.id,
          objectKey: skill.packageObjectKey,
          status: 'FINALIZED',
        },
      })
      if (
        !upload ||
        upload.observedSizeBytes === null ||
        upload.observedSha256 === null ||
        upload.finalizedAt === null
      ) {
        throw new SkillClaimPersistenceError(
          'SKILL_UPLOAD_NOT_FINALIZED',
          '覆盖上传会话不存在、未完成或不属于当前 Skill',
        )
      }
      return tx.skill.update({
        where: { id: skill.id },
        data: {
          title: input.title,
          description: input.description,
          category: input.category,
          ...(input.iconObjectKey === undefined ? {} : { iconObjectKey: input.iconObjectKey }),
          packageSha256: upload.observedSha256,
          packageSizeBytes: upload.observedSizeBytes,
          packageUpdatedAt: upload.finalizedAt,
        },
        select: CLAIMED_SKILL_SELECT,
      })
    })
  }

  async delistOwned(userId: string, name: string, now: Date): Promise<ClaimedSkillRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.skill.findUnique({
        where: { name },
        select: CLAIMED_SKILL_SELECT,
      })
      if (!current) throw new SkillClaimPersistenceError('SKILL_NOT_FOUND', 'Skill 不存在')
      if (current.ownerId !== userId) {
        throw new SkillClaimPersistenceError('SKILL_NOT_OWNER', '只有 Skill owner 可以下架')
      }
      if (current.status !== 'PUBLISHED') {
        throw new SkillClaimPersistenceError(
          'SKILL_DELIST_INVALID_TRANSITION',
          '只有已发布的 Skill 可以下架',
        )
      }
      return tx.skill.update({
        where: { id: current.id },
        data: { status: 'DELISTED', delistedAt: now },
        select: CLAIMED_SKILL_SELECT,
      })
    })
  }

  listOwned(userId: string): Promise<ClaimedSkillRecord[]> {
    return this.prisma.skill.findMany({
      where: { ownerId: userId },
      select: CLAIMED_SKILL_SELECT,
      orderBy: { updatedAt: 'desc' },
    })
  }

  findByName(name: string): Promise<ClaimedSkillRecord | null> {
    return this.prisma.skill.findUnique({ where: { name }, select: CLAIMED_SKILL_SELECT })
  }
}

export class SkillClaimPersistenceError extends Error {
  constructor(
    readonly code:
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
    this.name = 'SkillClaimPersistenceError'
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
