import { createHmac, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../skills/storage/skill-object-store.port';
import { SANDBOX_RUNTIME_PORT, type SandboxRuntimePort } from '../sandbox/sandbox-runtime.port';

const MAX = 10_000_000;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
@Injectable()
export class VideoInputService {
  private readonly secret: string;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SANDBOX_RUNTIME_PORT) private readonly sandboxes: SandboxRuntimePort,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('USER_SESSION_SECRET');
  }
  async upload(
    userId: string,
    threadId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    if (
      !TYPES.has(file.mimetype) ||
      file.size < 1 ||
      file.size > MAX ||
      !magic(file.buffer, file.mimetype)
    )
      throw new BadRequestException('参考图仅支持10MB以内JPEG、PNG或WEBP');
    const assetId = crypto.randomUUID();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const thread = await this.prisma.agentThread.findFirst({
      where: { id: threadId, userId },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Thread不存在');
    const objectKey = `video-staging/${userId.replaceAll('-', '')}/${assetId}/first-frame.${extension}`;
    const stored = await this.objects.writeUserFile({
      objectKey,
      direction: 'input',
      fileName: `first-frame.${extension}`,
      contentType: file.mimetype,
      bytes: file.buffer,
    });
    try {
      const asset = await this.prisma.videoInputAsset.create({
        data: {
          id: assetId,
          userId,
          threadId,
          objectKey,
          name: safe(file.originalname),
          mimeType: file.mimetype,
          sizeBytes: stored.metadata.sizeBytes,
          sha256: stored.metadata.sha256,
          expiresAt: new Date(Date.now() + 2 * 60 * 60_000),
        },
        select: { id: true, name: true, mimeType: true, sizeBytes: true, expiresAt: true },
      });
      return { ...asset, sizeBytes: Number(asset.sizeBytes) };
    } catch (error) {
      await this.objects.deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
  }
  async owned(userId: string, threadId: string, id: string) {
    const row = await this.prisma.videoInputAsset.findFirst({
      where: { id, userId, threadId, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new NotFoundException('参考图不存在或已过期');
    return row;
  }
  async readOwned(userId: string, threadId: string, id: string) {
    const asset = await this.owned(userId, threadId, id);
    const file = asset.objectKey
      ? await this.objects.loadUserFile(asset.objectKey)
      : asset.sandboxId && asset.sandboxPath
        ? await this.sandboxes.readFile(asset.sandboxId, asset.sandboxPath)
        : null;
    if (!file) throw new NotFoundException('参考图不存在或已过期');
    return {
      asset,
      file: 'metadata' in file
        ? {
            bytes: file.bytes,
            sizeBytes: file.metadata.sizeBytes,
            sha256: file.metadata.sha256,
          }
        : file,
    };
  }
  async providerUrl(userId: string, threadId: string, id: string) {
    const asset = await this.owned(userId, threadId, id);
    if (!asset.objectKey) return null;
    return this.objects.createUserFileDownload(asset.objectKey, 30 * 60);
  }
  async release(id: string) {
    const asset = await this.prisma.videoInputAsset.findUnique({ where: { id } });
    if (!asset?.objectKey) return;
    await this.objects.deleteObject(asset.objectKey).catch(() => undefined);
    await this.prisma.videoInputAsset.updateMany({
      where: { id, objectKey: asset.objectKey },
      data: { objectKey: null, expiresAt: new Date() },
    });
  }
  async removeUnsubmitted(userId: string, threadId: string, id: string) {
    const asset = await this.prisma.videoInputAsset.findFirst({ where: { id, userId, threadId } });
    if (!asset) return;
    const referenced = await this.prisma.videoGenerationTask.count({
      where: { referenceImageId: id },
    });
    if (referenced > 0) return;
    if (asset.objectKey) await this.objects.deleteObject(asset.objectKey).catch(() => undefined);
    await this.prisma.videoInputAsset.deleteMany({ where: { id, userId, threadId } });
  }
  sign(assetId: string, taskId: string, expiresAt = new Date(Date.now() + 30 * 60_000)) {
    const exp = Math.min(expiresAt.getTime(), Date.now() + 2 * 60 * 60_000);
    const body = `${assetId}.${taskId}.${exp}`;
    return {
      token: `${body}.${createHmac('sha256', this.secret).update(body).digest('hex')}`,
      expiresAt: new Date(exp),
    };
  }
  async readSigned(token: string) {
    const [assetId, taskId, expRaw, sig] = token.split('.');
    if (!assetId || !taskId || !expRaw || !sig) throw new NotFoundException();
    const body = `${assetId}.${taskId}.${expRaw}`;
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ||
      Number(expRaw) <= Date.now()
    )
      throw new NotFoundException();
    const task = await this.prisma.videoGenerationTask.findFirst({
      where: { taskId, referenceImageId: assetId, status: { in: ['SUBMITTING', 'RUNNING'] } },
      select: { threadId: true, userId: true },
    });
    if (!task) throw new NotFoundException();
    return this.readOwned(task.userId, task.threadId, assetId);
  }
}
function magic(b: Buffer, m: string) {
  if (m === 'image/png')
    return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (m === 'image/webp')
    return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return b[0] === 0xff && b[1] === 0xd8;
}
function safe(v: string) {
  return (
    posix
      .basename(v)
      .replace(/[^\p{L}\p{N}._-]/gu, '_')
      .slice(0, 255) || 'reference'
  );
}
