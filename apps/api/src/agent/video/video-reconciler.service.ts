import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type VideoGenerationTask } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { VideoGenerationService } from './video-generation.service';
@Injectable()
export class VideoReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoReconcilerService.name);
  private readonly owner = `video-${randomUUID()}`;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VideoGenerationService) private readonly videos: VideoGenerationService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 3000);
    this.timer.unref?.();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.claim(5);
      for (const row of rows)
        try {
          const result = await this.videos.resume(row.id);
          if (['succeeded', 'failed', 'timed_out', 'cancelled', 'expired'].includes(result.status))
            await this.finishRun(row, result);
        } catch (e) {
          this.logger.warn({ taskId: row.taskId, error: e }, 'Video reconciliation failed');
        } finally {
          await this.prisma.videoGenerationTask.updateMany({
            where: { id: row.id, leaseOwner: this.owner },
            data: { leaseOwner: null, leaseExpiresAt: null },
          });
        }
    } finally {
      this.running = false;
    }
  }
  private async claim(take: number) {
    const now = new Date();
    const candidates = await this.prisma.videoGenerationTask.findMany({
      where: {
        status: { in: ['RUNNING', 'PERSISTING'] },
        OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
        AND: [{ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }],
      },
      take,
      orderBy: { nextPollAt: 'asc' },
    });
    const out: VideoGenerationTask[] = [];
    for (const row of candidates) {
      const leaseExpiresAt = new Date(Date.now() + 120000);
      const got = await this.prisma.videoGenerationTask.updateMany({
        where: { id: row.id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        data: { leaseOwner: this.owner, leaseExpiresAt },
      });
      if (got.count) out.push({ ...row, leaseOwner: this.owner, leaseExpiresAt });
    }
    return out;
  }
  private async finishRun(
    task: VideoGenerationTask,
    result: ReturnType<VideoGenerationService['project']>,
  ) {
    if (!task.agentRunId) return;
    const run = await this.prisma.agentRun.findUnique({ where: { id: task.agentRunId } });
    if (!run || !['RUNNING', 'CANCELLING'].includes(run.status)) return;
    await this.prisma.$transaction(async (tx) => {
      if (task.agentToolCallId)
        await tx.agentToolCall.update({
          where: { id: task.agentToolCallId },
          data: {
            status:
              result.status === 'succeeded'
                ? 'SUCCEEDED'
                : result.status === 'cancelled'
                  ? 'CANCELLED'
                  : 'FAILED',
            result: result as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      const last = await tx.agentMessage.findFirst({
        where: { threadId: run.threadId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      await tx.agentMessage.create({
        data: {
          threadId: run.threadId,
          runId: run.id,
          role: 'TOOL',
          sequence: (last?.sequence ?? -1) + 1,
          parts: [
            {
              type: 'tool-result',
              toolCallId: task.agentToolCallId ?? task.taskId,
              toolName: 'generate_video',
              status: result.status === 'succeeded' ? 'succeeded' : 'failed',
              isError: result.status !== 'succeeded',
              summary: result.status === 'succeeded' ? '视频生成成功' : '视频生成未成功',
              videoGeneration: result,
            },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      const status =
        result.status === 'succeeded'
          ? 'SUCCEEDED'
          : result.status === 'cancelled'
            ? 'CANCELLED'
            : 'FAILED';
      await tx.agentRun.updateMany({
        where: { id: run.id, status: { in: ['RUNNING', 'CANCELLING'] } },
        data: {
          status,
          completedAt: new Date(),
          ...(status === 'FAILED'
            ? {
                errorCode: result.error?.code ?? 'VIDEO_FAILED',
                errorMessage: result.error?.message ?? '视频生成失败',
              }
            : {}),
        },
      });
    });
  }
}
