import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../skills/storage/skill-object-store.port';
import { ImageGenerationService } from './image-generation.service';

@Injectable()
export class ImageAssetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImageGenerationService) private readonly images: ImageGenerationService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
  ) {}

  async save(userId: string, imageId: string) {
    const existing = await this.prisma.creation.findFirst({
      where: { userId, imageTask: { imageId } },
      include: {
        assets: true,
        imageTask: { select: { agentRunId: true, agentToolCallId: true } },
      },
    });
    if (existing) {
      await this.markSaved(existing.imageTask, existing.id);
      return projectSaved(existing);
    }

    const { task, file } = await this.images.readOwnedImage(userId, imageId);
    const creationId = randomUUID();
    const assetId = randomUUID();
    const extension =
      task.mimeType === 'image/png' ? 'png' : task.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const objectKey = `users/${opaque(userId)}/creations/${creationId}/assets/${assetId}.${extension}`;
    let written = false;
    try {
      await this.objects.writeUserFile({
        objectKey,
        direction: 'output',
        fileName: `image.${extension}`,
        contentType: task.mimeType!,
        bytes: file.bytes,
      });
      written = true;
      const creation = await this.prisma.$transaction(async (tx) => {
        const raced = await tx.creation.findFirst({
          where: { userId, imageTaskId: task.id },
          include: { assets: true },
        });
        if (raced) return raced;
        return tx.creation.create({
          data: {
            id: creationId,
            userId,
            type: 'IMAGE',
            status: 'SUCCEEDED',
            title: task.effectivePrompt?.slice(0, 80) || '图片创作',
            imageTaskId: task.id,
            assets: {
              create: {
                id: assetId,
                kind: 'IMAGE',
                name: `image.${extension}`,
                mimeType: task.mimeType!,
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
      await this.markSaved(
        { agentRunId: task.agentRunId, agentToolCallId: task.agentToolCallId },
        creation.id,
      );
      return projectSaved(creation);
    } catch (error) {
      if (written) await this.objects.deleteObject(objectKey).catch(() => undefined);
      throw new ServiceUnavailableException('保存图片失败，请稍后重试', { cause: error });
    }
  }

  async loadSaved(userId: string, assetId: string) {
    const asset = await this.prisma.creationAsset.findFirst({
      where: {
        id: assetId,
        kind: 'IMAGE',
        creation: { userId, type: 'IMAGE', status: 'SUCCEEDED' },
      },
    });
    if (!asset) throw new NotFoundException('图片作品不存在');
    const stored = await this.objects.loadUserFile(asset.objectKey);
    if (!stored) throw new NotFoundException('图片作品不存在');
    return { asset, stored };
  }

  private async markSaved(
    task: { agentRunId: string | null; agentToolCallId: string | null } | null,
    creationId: string,
  ): Promise<void> {
    if (!task?.agentRunId || !task.agentToolCallId) return;
    await this.prisma.$transaction(async (tx) => {
      const toolCall = await tx.agentToolCall.findUnique({
        where: { id: task.agentToolCallId! },
        select: { toolCallId: true, result: true },
      });
      if (!toolCall) return;
      const result = isRecord(toolCall.result)
        ? { ...toolCall.result, saved: true, creationId }
        : { saved: true, creationId };
      await tx.agentToolCall.update({
        where: { id: task.agentToolCallId! },
        data: { result: result as Prisma.InputJsonValue },
      });
      const messages = await tx.agentMessage.findMany({
        where: { runId: task.agentRunId, role: 'TOOL' },
        select: { id: true, parts: true },
      });
      for (const message of messages) {
        if (!Array.isArray(message.parts)) continue;
        let changed = false;
        const parts = message.parts.map((part) => {
          if (!isRecord(part) || part.toolCallId !== toolCall.toolCallId) return part;
          const audit = isRecord(part.audit) ? part.audit : {};
          const imageGeneration = isRecord(audit.imageGeneration) ? audit.imageGeneration : {};
          changed = true;
          return {
            ...part,
            audit: {
              ...audit,
              imageGeneration: { ...imageGeneration, saved: true, creationId },
            },
          };
        });
        if (changed)
          await tx.agentMessage.update({
            where: { id: message.id },
            data: { parts: parts as Prisma.InputJsonValue },
          });
      }
    });
  }
}

function opaque(userId: string): string {
  return userId.replaceAll('-', '');
}

function projectSaved(creation: { id: string; assets: Array<{ id: string }> }) {
  const asset = creation.assets.find((item) => item.id);
  return { creationId: creation.id, assetId: asset?.id ?? null, saved: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
