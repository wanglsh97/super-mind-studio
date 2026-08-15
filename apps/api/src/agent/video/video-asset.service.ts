import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../skills/storage/skill-object-store.port';
import { VideoGenerationService } from './video-generation.service';

@Injectable()
export class VideoAssetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VideoGenerationService) private readonly videos: VideoGenerationService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
  ) {}
  async save(userId: string, videoId: string) {
    const existing = await this.prisma.creation.findFirst({
      where: { userId, videoTask: { videoId } },
      include: { assets: true },
    });
    if (existing) return project(existing);
    const { task, file } = await this.videos.readOwned(userId, videoId);
    const creationId = randomUUID(),
      assetId = randomUUID(),
      objectKey = `users/${userId.replaceAll('-', '')}/creations/${creationId}/assets/${assetId}.mp4`;
    let written = false;
    try {
      await this.objects.writeUserFile({
        objectKey,
        direction: 'output',
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        bytes: file.bytes,
      });
      written = true;
      const creation = await this.prisma.$transaction(async (tx) => {
        const raced = await tx.creation.findFirst({
          where: { videoTaskId: task.id },
          include: { assets: true },
        });
        if (raced) return raced;
        const parent = task.parentVideoTaskId
          ? await tx.creation.findFirst({
              where: { videoTaskId: task.parentVideoTaskId },
              select: { id: true },
            })
          : null;
        return tx.creation.create({
          data: {
            id: creationId,
            userId,
            type: 'VIDEO',
            status: 'SUCCEEDED',
            title: task.effectivePrompt.slice(0, 80) || '视频创作',
            videoTaskId: task.id,
            ...(parent ? { parentCreationId: parent.id } : {}),
            assets: {
              create: {
                id: assetId,
                kind: 'VIDEO',
                name: 'video.mp4',
                mimeType: 'video/mp4',
                objectKey,
                sizeBytes: file.sizeBytes,
                sha256: file.sha256,
              },
            },
          },
          include: { assets: true },
        });
      });
      if (creation.id !== creationId && written)
        await this.objects.deleteObject(objectKey).catch(() => undefined);
      return project(creation);
    } catch (e) {
      if (written) await this.objects.deleteObject(objectKey).catch(() => undefined);
      throw new ServiceUnavailableException('保存视频失败', { cause: e });
    }
  }
  async load(userId: string, assetId: string) {
    const asset = await this.prisma.creationAsset.findFirst({
      where: {
        id: assetId,
        kind: 'VIDEO',
        creation: { userId, type: 'VIDEO', status: 'SUCCEEDED' },
      },
    });
    if (!asset) throw new NotFoundException('视频作品不存在');
    const stored = await this.objects.loadUserFile(asset.objectKey);
    if (!stored) throw new NotFoundException('视频作品不存在');
    return { asset, stored };
  }
  async remove(userId: string, creationId: string) {
    const creation = await this.prisma.creation.findFirst({
      where: { id: creationId, userId, type: 'VIDEO' },
      include: { assets: true },
    });
    if (!creation) throw new NotFoundException('视频作品不存在');
    await this.prisma.creation.update({ where: { id: creation.id }, data: { status: 'DELETING' } });
    for (const asset of creation.assets) await this.objects.deleteObject(asset.objectKey);
    await this.prisma.creation.delete({ where: { id: creation.id } });
  }
}
function project(c: { id: string; assets: Array<{ id: string }> }) {
  return { creationId: c.id, assetId: c.assets[0]?.id ?? null, saved: true as const };
}
