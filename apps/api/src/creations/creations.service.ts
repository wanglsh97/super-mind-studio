import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import type { Creation, CreationAsset, WebProject } from '../generated/prisma/client'
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../agent/skills/storage/skill-object-store.port'
import { PrismaService } from '../database/prisma.service'
import type { AuthenticatedUser } from '../user/user.types'
import { CreationRepository } from './creation.repository'

@Injectable()
export class CreationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
    @Inject(CreationRepository) private readonly projects: CreationRepository,
  ) {}

  async list(user: AuthenticatedUser) {
    const now = new Date()
    const [websites, images] = await Promise.all([
      this.projects.listWebsitesForOwner(user.id),
      this.prisma.imageGenerationTask.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: {
          taskId: true,
          prompt: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          results: true,
        },
      }),
    ])
    return [
      ...websites
        .filter(
          (project) =>
            project.status === 'SUCCEEDED' && !isExpired(project.creation.expiresAt, now),
        )
        .map((project) => toWebsiteCreation(project)),
      ...images.map((image) => ({
        id: `image:${image.taskId}`,
        type: 'image' as const,
        status: image.status.toLowerCase(),
        title: image.prompt.slice(0, 80) || '图片创作',
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString(),
        imageTaskId: image.taskId,
        imageCount: Array.isArray(image.results) ? image.results.length : 0,
        expiresAt: null,
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async loadAsset(user: AuthenticatedUser, assetId: string) {
    const asset = await this.prisma.creationAsset.findFirst({
      where: {
        id: assetId,
        creation: { userId: user.id, status: 'SUCCEEDED' },
      },
      include: { creation: { select: { expiresAt: true } } },
    })
    const now = new Date()
    if (!asset || isExpired(asset.expiresAt, now) || isExpired(asset.creation.expiresAt, now)) {
      throw new NotFoundException('创作产物不存在或已过期')
    }
    const stored = await this.objects.loadUserFile(asset.objectKey)
    if (!stored) throw new NotFoundException('创作产物不存在或已过期')
    return { asset, stored }
  }
}

type WebsiteProject = WebProject & { creation: Creation & { assets: CreationAsset[] } }

function toWebsiteCreation(project: WebsiteProject) {
  return {
    id: project.creation.id,
    projectId: project.id,
    type: 'website' as const,
    status: 'succeeded',
    title: project.creation.title,
    createdAt: project.creation.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    expiresAt: project.creation.expiresAt?.toISOString() ?? null,
    threadId: project.agentThreadId,
    runId: project.agentRunId,
    assets: project.creation.assets
      .filter((asset) => asset.kind === 'SOURCE_ZIP' || asset.kind === 'DIST_ZIP')
      .map((asset) => ({
        id: asset.id,
        kind: asset.kind.toLowerCase(),
        name: asset.name,
        expiresAt: asset.expiresAt?.toISOString() ?? null,
        downloadUrl: `/api/v1/creations/assets/${asset.id}/content`,
      })),
  }
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt <= now
}
