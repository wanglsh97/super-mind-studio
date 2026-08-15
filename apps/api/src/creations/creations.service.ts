import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { SKILL_OBJECT_STORE_PORT } from '../agent/skills/storage/skill-object-store.port';
import { toWebsiteArchiveBasename } from '../agent/website/website-project-name';
import { PrismaService } from '../database/prisma.service';

import { CreationRepository } from './creation.repository';
import { WebProjectArchiveValidator } from './web-project-archive.validator';

import type { SkillObjectStorePort } from '../agent/skills/storage/skill-object-store.port';
import type { Creation, CreationAsset, WebProject } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../user/user.types';

@Injectable()
export class CreationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
    @Inject(CreationRepository) private readonly projects: CreationRepository,
    @Inject(WebProjectArchiveValidator) private readonly archives: WebProjectArchiveValidator,
  ) {}

  async list(user: AuthenticatedUser) {
    const now = new Date();
    const [websites, images, videos] = await Promise.all([
      this.projects.listWebsitesForOwner(user.id),
      this.prisma.creation.findMany({
        where: { userId: user.id, type: 'IMAGE', status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        include: { assets: { where: { kind: 'IMAGE' } }, imageTask: true },
      }),
      this.prisma.creation.findMany({
        where: { userId: user.id, type: 'VIDEO', status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        include: { assets: { where: { kind: 'VIDEO' } }, videoTask: true },
      }),
    ]);
    return [
      ...websites
        .filter(
          (project) =>
            project.status === 'SUCCEEDED' && !isExpired(project.creation.expiresAt, now),
        )
        .map((project) => toWebsiteCreation(project)),
      ...images.map((image) => ({
        id: image.id,
        type: 'image' as const,
        status: 'succeeded',
        title: image.title,
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString(),
        imageTaskId: image.imageTask?.taskId,
        imageCount: image.assets.length,
        expiresAt: null,
        assets: image.assets.map((asset) => ({
          id: asset.id,
          kind: 'image',
          name: asset.name,
          expiresAt: null,
          previewUrl: `/api/v1/creations/assets/${asset.id}/preview`,
          downloadUrl: `/api/v1/creations/assets/${asset.id}/content`,
        })),
      })),
      ...videos.map((video) => ({
        id: video.id,
        type: 'video' as const,
        status: 'succeeded',
        title: video.title,
        createdAt: video.createdAt.toISOString(),
        updatedAt: video.updatedAt.toISOString(),
        videoTaskId: video.videoTask?.taskId,
        expiresAt: null,
        assets: video.assets.map((asset) => ({
          id: asset.id,
          kind: 'video',
          name: asset.name,
          expiresAt: null,
          previewUrl: `/api/v1/creations/assets/${asset.id}/preview`,
          downloadUrl: `/api/v1/creations/assets/${asset.id}/content`,
        })),
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async loadAsset(user: AuthenticatedUser, assetId: string) {
    const asset = await this.prisma.creationAsset.findFirst({
      where: {
        id: assetId,
        creation: { userId: user.id, status: 'SUCCEEDED' },
      },
      include: { creation: { select: { expiresAt: true } } },
    });
    const now = new Date();
    if (!asset || isExpired(asset.expiresAt, now) || isExpired(asset.creation.expiresAt, now)) {
      throw new NotFoundException('创作产物不存在或已过期');
    }
    const stored = await this.objects.loadUserFile(asset.objectKey);
    if (!stored) throw new NotFoundException('创作产物不存在或已过期');
    if (asset.kind !== 'SOURCE_ZIP' || asset.name !== 'source.zip') {
      return { asset, stored };
    }
    const legacyProjectName = await this.archives.readSourceProjectName(stored.bytes);
    return {
      asset: {
        ...asset,
        name: legacyProjectName ? `${toWebsiteArchiveBasename(legacyProjectName)}.zip` : asset.name,
      },
      stored,
    };
  }
}

type WebsiteProject = WebProject & { creation: Creation & { assets: CreationAsset[] } };

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
  };
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt <= now;
}
