import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { Prisma, type ImageGenerationTask } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ImageGenerationService } from './image-generation.service';
import { MODEL_INVOCATION_PORT, type ModelInvocationPort } from '../../chat/model-invocation.port';
import { RequestLifecycleService } from '../../request-lifecycle/request-lifecycle.service';
import { PricingService } from '../../billing/pricing.service';
import { AgentModelInvocationRepository } from '../agent-model-invocation.repository';
import { TelemetryService } from '../../observability/telemetry.service';
import { createAgentModelInvocationPort } from '../agent-model-invocation';
import { AgentRunService } from '../agent-run.service';

@Injectable()
export class ImageReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageReconcilerService.name);
  private readonly owner = `image-reconciler-${randomUUID()}`;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImageGenerationService) private readonly images: ImageGenerationService,
    @Inject(MODEL_INVOCATION_PORT) private readonly modelInvocation: ModelInvocationPort,
    @Inject(RequestLifecycleService) private readonly lifecycle: RequestLifecycleService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(AgentModelInvocationRepository)
    private readonly invocations: AgentModelInvocationRepository,
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
    @Inject(AgentRunService) private readonly agentRuns: AgentRunService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 2_000);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.classifyAbandonedSubmissions();
      await this.expireDeadSandboxes();
      await this.resumeReadyRuns();
      const tasks = await this.claim(10);
      for (const task of tasks) {
        try {
          if (task.agentRunId && this.agentRuns.isRunning(task.agentRunId)) continue;
          const result = await this.images.resumePersistedTask(task.id);
          if (
            result.status === 'succeeded' ||
            ['failed', 'cancelled', 'expired', 'submission_unknown'].includes(result.status)
          ) {
            await this.completeRecoveredRun(task, result);
          }
        } catch (error) {
          this.logger.warn({ error, taskId: task.taskId }, 'Image reconciliation attempt failed');
        } finally {
          await this.prisma.imageGenerationTask.updateMany({
            where: { id: task.id, leaseOwner: this.owner },
            data: { leaseOwner: null, leaseExpiresAt: null },
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async resumeReadyRuns(): Promise<void> {
    const tasks = await this.prisma.imageGenerationTask.findMany({
      where: {
        status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'SUBMISSION_UNKNOWN'] },
        agentRun: { status: { in: ['RUNNING', 'CANCELLING'] } },
      },
      orderBy: { completedAt: 'asc' },
      take: 10,
    });
    for (const task of tasks) {
      await this.completeRecoveredRun(task, this.images.projectPersistedTask(task)).catch(
        (error) => {
          this.logger.warn({ error, taskId: task.taskId }, 'Recovered image Run summary failed');
        },
      );
    }
  }

  private async classifyAbandonedSubmissions(): Promise<void> {
    const cutoff = new Date(Date.now() - 120_000);
    const rows = await this.prisma.imageGenerationTask.findMany({
      where: { status: 'SUBMITTING', providerTaskId: null, updatedAt: { lt: cutoff } },
      select: { id: true, requestLogId: true },
      take: 50,
    });
    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.imageGenerationTask.updateMany({
          where: { id: row.id, status: 'SUBMITTING', providerTaskId: null },
          data: {
            status: 'SUBMISSION_UNKNOWN',
            errorCode: 'IMAGE_SUBMISSION_UNKNOWN',
            errorMessage: '服务中断时提交结果不确定，平台不会自动重提',
            completedAt: new Date(),
          },
        });
        if (updated.count === 0) return;
        await tx.requestLog.updateMany({
          where: { id: row.requestLogId, status: 'PENDING' },
          data: {
            status: 'FAILED',
            errorCode: 'IMAGE_SUBMISSION_UNKNOWN',
            errorMessage: '服务中断时提交结果不确定，平台不会自动重提',
            completedAt: new Date(),
          },
        });
        await tx.billingRecord.upsert({
          where: { requestLogId: row.requestLogId },
          create: { requestLogId: row.requestLogId, usageUnknown: true },
          update: { usageUnknown: true },
        });
      });
    }
  }

  private async expireDeadSandboxes(): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.imageGenerationTask.findMany({
      where: {
        status: { in: ['PENDING', 'SUBMITTING', 'RUNNING', 'PERSISTING'] },
        sandboxExpiresAt: { lte: now },
      },
      select: { id: true, status: true, providerTaskId: true, requestLogId: true },
      take: 50,
    });
    for (const row of rows) {
      if (row.providerTaskId) {
        await this.images.requestCancel(row.id).catch(() => undefined);
        await this.prisma.imageGenerationTask.updateMany({
          where: { id: row.id, status: 'CANCELLED' },
          data: { status: 'EXPIRED', expiredAt: now },
        });
      } else {
        await this.prisma.imageGenerationTask.updateMany({
          where: { id: row.id, status: { in: ['PENDING', 'SUBMITTING'] } },
          data: {
            status: 'CANCELLED',
            cancelRequestedAt: now,
            completedAt: now,
            errorCode: 'IMAGE_SANDBOX_EXPIRED',
            errorMessage: 'Sandbox 在提交前过期',
          },
        });
      }
    }
  }

  private async claim(take: number): Promise<ImageGenerationTask[]> {
    const candidates = await this.prisma.imageGenerationTask.findMany({
      where: {
        status: { in: ['RUNNING', 'PERSISTING', 'CANCEL_REQUESTED'] },
        OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
        AND: [{ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] }],
      },
      orderBy: { nextPollAt: 'asc' },
      take,
    });
    const claimed: ImageGenerationTask[] = [];
    for (const task of candidates) {
      const leaseExpiresAt = new Date(Date.now() + 120_000);
      const updated = await this.prisma.imageGenerationTask.updateMany({
        where: {
          id: task.id,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
        },
        data: { leaseOwner: this.owner, leaseExpiresAt },
      });
      if (updated.count === 1) claimed.push({ ...task, leaseOwner: this.owner, leaseExpiresAt });
    }
    return claimed;
  }

  private async completeRecoveredRun(
    task: ImageGenerationTask,
    result: Awaited<ReturnType<ImageGenerationService['resumePersistedTask']>>,
  ): Promise<void> {
    if (!task.agentRunId) return;
    if (this.agentRuns.isRunning(task.agentRunId)) return;
    const leaseExpiresAt = new Date(Date.now() + 120_000);
    const claimed = task.agentToolCallId
      ? await this.prisma.agentToolCall.updateMany({
          where: {
            id: task.agentToolCallId,
            OR: [{ resumeLeaseExpiresAt: null }, { resumeLeaseExpiresAt: { lt: new Date() } }],
          },
          data: { resumeLeaseOwner: this.owner, resumeLeaseExpiresAt: leaseExpiresAt },
        })
      : { count: 1 };
    if (claimed.count === 0) return;
    const runForSummary = await this.prisma.agentRun.findUnique({ where: { id: task.agentRunId } });
    if (!runForSummary || !['RUNNING', 'CANCELLING'].includes(runForSummary.status)) return;
    let summary: string;
    try {
      summary = await this.generateFinalSummary(runForSummary, result);
    } catch (error) {
      await this.prisma.agentRun.updateMany({
        where: { id: runForSummary.id, status: { in: ['RUNNING', 'CANCELLING'] } },
        data: {
          status: 'FAILED',
          errorCode: 'IMAGE_FINAL_SUMMARY_FAILED',
          errorMessage: error instanceof Error ? error.message : '最终模型总结失败',
          completedAt: new Date(),
        },
      });
      throw error;
    }
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.findUnique({ where: { id: task.agentRunId! } });
      if (!run || !['RUNNING', 'CANCELLING'].includes(run.status)) return;
      const lastMessage = await tx.agentMessage.findFirst({
        where: { threadId: run.threadId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      const base = lastMessage?.sequence ?? -1;
      await tx.agentMessage.createMany({
        data: [
          {
            threadId: run.threadId,
            runId: run.id,
            role: 'TOOL',
            sequence: base + 1,
            parts: [
              {
                type: 'tool-result',
                toolCallId: task.agentToolCallId ?? task.taskId,
                toolName: 'generate_image',
                status: result.status === 'succeeded' ? 'succeeded' : 'failed',
                isError: result.status !== 'succeeded',
                summary: result.status === 'succeeded' ? '图片生成成功' : '图片生成未成功',
                audit: { imageGeneration: result },
              },
            ] as unknown as Prisma.InputJsonValue,
          },
          {
            threadId: run.threadId,
            runId: run.id,
            role: 'ASSISTANT',
            sequence: base + 2,
            parts: [{ type: 'text', text: summary }] as Prisma.InputJsonValue,
          },
        ],
      });
      const eventSequence = run.lastSequence + 1;
      const status =
        result.status === 'succeeded'
          ? 'SUCCEEDED'
          : result.status === 'cancelled'
            ? 'CANCELLED'
            : 'FAILED';
      await tx.agentEvent.create({
        data: {
          runId: run.id,
          sequence: eventSequence,
          type: 'run-terminal',
          payload: {
            type: 'run-terminal',
            sequence: eventSequence,
            runId: run.id,
            status: status.toLowerCase(),
            limitReason: null,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          status,
          lastSequence: eventSequence,
          completedAt: new Date(),
          ...(status === 'FAILED'
            ? {
                errorCode: result.error?.code ?? 'IMAGE_GENERATION_FAILED',
                errorMessage: result.error?.message ?? '图片生成未成功',
              }
            : {}),
        },
      });
      if (task.agentToolCallId)
        await tx.agentToolCall.update({
          where: { id: task.agentToolCallId },
          data: {
            resumeLeaseOwner: null,
            resumeLeaseExpiresAt: null,
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
    });
  }

  private async generateFinalSummary(
    run: { id: string; userId: string; modelId: string; input: string },
    result: Awaited<ReturnType<ImageGenerationService['resumePersistedTask']>>,
  ): Promise<string> {
    const bound = createAgentModelInvocationPort(
      this.modelInvocation,
      this.lifecycle,
      this.pricing,
      this.invocations,
      this.telemetry,
      { userId: run.userId, agentRunId: run.id, activeSkillNames: () => ['gen-image'] },
    );
    let text = '';
    for await (const event of bound.invoke({
      requestId: randomUUID(),
      modelId: run.modelId,
      messages: [
        {
          role: 'system',
          content:
            '你是图像创作助手。根据结构化工具结果简短说明图片已生成，不要罗列替代模型、比例或质量，这些操作由结构化 UI 展示。不要输出图片 URL，不要再次调用工具。',
        },
        { role: 'user', content: run.input },
        {
          role: 'tool',
          toolCallId: taskToolCallId(result),
          toolName: 'generate_image',
          content: JSON.stringify(result),
        },
      ],
      toolChoice: 'none',
      maxTokens: 300,
      signal: new AbortController().signal,
    })) {
      if (event.type === 'text') text += event.delta;
    }
    return text.trim() || recoveredSummary(result);
  }
}

function taskToolCallId(
  result: Awaited<ReturnType<ImageGenerationService['resumePersistedTask']>>,
): string {
  return `generate-image-${result.taskId}`;
}

function recoveredSummary(
  result: Awaited<ReturnType<ImageGenerationService['resumePersistedTask']>>,
): string {
  if (result.status !== 'succeeded')
    return `图片任务在服务恢复后终结为 ${result.status}。不会自动重试或切换图片模型。`;
  return `图片已由 ${result.modelName} 生成。`;
}
