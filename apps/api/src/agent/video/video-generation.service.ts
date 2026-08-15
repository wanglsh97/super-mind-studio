import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type {
  GenerateVideoToolArguments,
  VideoGenerationSuggestion,
  VideoGenerationToolResult,
} from '@supermind/sdk';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VideoGenerationTask } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SANDBOX_RUNTIME_PORT, type SandboxRuntimePort } from '../sandbox/sandbox-runtime.port';
import type { AgentToolContext } from '../tools/agent-tool';
import { AgentToolExecutionError } from '../tools/agent-tool';
import { BailianVideoTransport } from './bailian-video.transport';
import { mapBailianVideoRequest } from './bailian-video.mapper';
import { VideoInputService } from './video-input.service';
import { VideoModelCatalog, type VideoRequestSettings } from './video-model.catalog';

const OUTPUT = '/workspace/output/videos';
class VideoResultDownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'VideoResultDownloadError';
  }
}
@Injectable()
export class VideoGenerationService {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VideoModelCatalog) private readonly catalog: VideoModelCatalog,
    @Inject(BailianVideoTransport) private readonly transport: BailianVideoTransport,
    @Inject(VideoInputService) private readonly inputs: VideoInputService,
    @Inject(SANDBOX_RUNTIME_PORT) private readonly sandboxes: SandboxRuntimePort,
    @Inject(ConfigService) _config: ConfigService,
  ) {
    this.timeoutMs = 900_000;
    this.maxBytes = 500_000_000;
  }
  async generate(
    raw: GenerateVideoToolArguments,
    ctx: AgentToolContext,
  ): Promise<VideoGenerationToolResult> {
    if (!ctx.runId || !ctx.userId)
      throw new AgentToolExecutionError({
        code: 'VIDEO_RUN_SCOPE_REQUIRED',
        message: '视频工具缺少Run上下文',
      });
    if (!this.transport.isConfigured())
      throw new AgentToolExecutionError({
        code: 'VIDEO_NOT_CONFIGURED',
        message: '百炼视频服务未配置',
      });
    if (!raw.prompt?.trim() || raw.prompt.length > 5000)
      throw new BadRequestException('视频Prompt长度必须为1–5000字符');
    const run = await this.prisma.agentRun.findFirst({
      where: { id: ctx.runId, userId: ctx.userId, mode: 'video' },
      include: { thread: true },
    });
    if (
      !run?.thread.sandboxId ||
      !run.thread.sandboxExpiresAt ||
      run.thread.sandboxExpiresAt <= new Date()
    )
      throw new AgentToolExecutionError({
        code: 'VIDEO_SANDBOX_EXPIRED',
        message: 'Thread Sandbox不可用',
      });
    const parent = await this.prisma.videoGenerationTask.findFirst({
      where: { threadId: run.threadId, status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
    });
    const inherited = readSettings(parent?.options);
    const referenceId = raw.referenceImageId ?? parent?.referenceImageId ?? undefined;
    if (referenceId) await this.inputs.owned(ctx.userId, run.threadId, referenceId);
    const requested: VideoRequestSettings = {
      inputMode: referenceId ? 'first_frame' : 'text',
      durationSeconds: integer(raw.durationSeconds) ?? inherited.durationSeconds,
      resolution: raw.resolution ?? inherited.resolution,
      aspectRatio: referenceId ? null : (raw.aspectRatio ?? inherited.aspectRatio ?? '16:9'),
      audio: raw.audio ?? inherited.audio,
      ...(raw.preferredBrand ? { preferredBrand: raw.preferredBrand } : {}),
    };
    let executable = requested;
    let route;
    try {
      route = this.catalog.choose(executable, run.thread.videoModelBinding);
    } catch {
      executable = {
        ...requested,
        durationSeconds: inherited.durationSeconds,
        resolution: inherited.resolution,
        aspectRatio: referenceId ? null : inherited.aspectRatio,
        audio: inherited.audio,
      };
      route = this.catalog.choose(executable, run.thread.videoModelBinding);
    }
    const id = randomUUID(),
      taskId = randomUUID(),
      videoId = randomUUID(),
      requestId = randomUUID();
    const task = await this.prisma.$transaction(async (tx) => {
      if (await tx.videoGenerationTask.findFirst({ where: { agentRunId: run.id } }))
        throw new AgentToolExecutionError({
          code: 'VIDEO_TOOL_DUPLICATE',
          message: '同一Run只能生成一个视频',
        });
      const tool = await tx.agentToolCall.upsert({
        where: { runId_toolCallId: { runId: run.id, toolCallId: ctx.toolCallId } },
        create: {
          runId: run.id,
          toolCallId: ctx.toolCallId,
          toolName: 'generate_video',
          args: raw as unknown as Prisma.InputJsonValue,
          status: 'RUNNING',
          sandboxId: run.thread.sandboxId,
        },
        update: {},
      });
      const log = await tx.requestLog.create({
        data: {
          requestId,
          userId: ctx.userId!,
          agentRunId: run.id,
          capability: 'VIDEO',
          prompt: {
            original: raw.prompt,
            effective: parent ? `${parent.effectivePrompt}\n修改：${raw.prompt}` : raw.prompt,
          } as unknown as Prisma.InputJsonValue,
          modelAlias: 'video-auto',
          provider: 'bailian',
          resolvedModel: route.model.upstreamModel,
          stream: false,
          metadata: {
            catalogVersion: this.catalog.version,
            settings: executable,
            candidates: route.candidates.map((m) => m.id),
            switched: route.switched,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.agentThread.update({
        where: { id: run.threadId },
        data: { preferredMode: 'video', videoModelBinding: route.model.id },
      });
      return tx.videoGenerationTask.create({
        data: {
          id,
          taskId,
          videoId,
          idempotencyKey: `video:${run.id}`,
          requestLogId: log.id,
          userId: ctx.userId!,
          threadId: run.threadId,
          agentRunId: run.id,
          agentToolCallId: tool.id,
          ...(parent ? { parentVideoTaskId: parent.id } : {}),
          prompt: raw.prompt,
          effectivePrompt: parent ? `${parent.effectivePrompt}\n修改：${raw.prompt}` : raw.prompt,
          inputMode: executable.inputMode,
          ...(referenceId ? { referenceImageId: referenceId } : {}),
          options: executable as unknown as Prisma.InputJsonValue,
          candidateAudit: {
            ids: route.candidates.map((m) => m.id),
            switched: route.switched,
          } as Prisma.InputJsonValue,
          provider: 'bailian',
          resolvedModel: route.model.upstreamModel,
          status: 'SUBMITTING',
          sandboxId: run.thread.sandboxId,
          sandboxExpiresAt: run.thread.sandboxExpiresAt,
          durationSeconds: executable.durationSeconds,
          audio: executable.audio,
          priceVersion: this.catalog.version,
          estimatedCostCny: new Prisma.Decimal(route.model.priceCnyPerSecond).mul(
            executable.durationSeconds,
          ),
        },
      });
    });
    try {
      let referenceUrl: string | undefined;
      if (referenceId) {
        const staged = await this.inputs.providerUrl(ctx.userId, run.threadId, referenceId);
        if (staged) referenceUrl = staged.url;
        else {
          const legacy = await this.inputs.readOwned(ctx.userId, run.threadId, referenceId);
          referenceUrl = `data:${legacy.asset.mimeType};base64,${Buffer.from(legacy.file.bytes).toString('base64')}`;
        }
      }
      const submitted = await this.transport.submit(
        route.model.submitPath,
        mapBailianVideoRequest(route.model, {
          ...executable,
          prompt: task.effectivePrompt,
          ...(referenceUrl ? { referenceUrl } : {}),
        }),
        task.idempotencyKey,
        ctx.signal,
      );
      await this.prisma.videoGenerationTask.update({
        where: { id: task.id },
        data: {
          providerTaskId: submitted.taskId,
          status: 'RUNNING',
          startedAt: new Date(),
          nextPollAt: new Date(),
        },
      });
      return await this.wait(task.id, ctx);
    } catch (e) {
      return this.fail(task, e);
    }
  }
  async wait(id: string, ctx: AgentToolContext) {
    for (;;) {
      const row = await this.prisma.videoGenerationTask.findUniqueOrThrow({ where: { id } });
      if (row.status === 'SUCCEEDED') return this.project(row);
      if (row.status === 'CANCELLED' || row.status === 'TIMED_OUT' || row.status === 'FAILED')
        return this.project(row);
      if (row.startedAt && Date.now() - row.startedAt.getTime() > this.timeoutMs)
        return this.timeout(row);
      if (ctx.signal.aborted) return this.cancel(row);
      if (row.status === 'PERSISTING') {
        await delay(1000, ctx.signal).catch(() => undefined);
        continue;
      }
      if (!row.providerTaskId) return this.project(row);
      const snap = await this.transport.query(row.providerTaskId, ctx.signal).catch((e) => ({
        status: 'FAILED' as const,
        errorMessage: e instanceof Error ? e.message : '查询失败',
      }));
      if (snap.status === 'FAILED' || snap.status === 'CANCELLED')
        return this.fail(row, new Error(snap.errorMessage ?? '视频任务失败'));
      if (snap.status === 'SUCCEEDED' && snap.resultUrl) {
        const claimed = await this.prisma.videoGenerationTask.updateMany({
          where: { id: row.id, status: 'RUNNING' },
          data: {
            status: 'PERSISTING',
            providerFinalStatus: 'SUCCEEDED',
            providerResultUrl: snap.resultUrl,
          },
        });
        if (claimed.count === 0) continue;
        return this.persist(
          await this.prisma.videoGenerationTask.findUniqueOrThrow({ where: { id: row.id } }),
          snap.resultUrl,
          ctx.signal,
        );
      }
      await this.prisma.videoGenerationTask.update({
        where: { id },
        data: {
          lastPolledAt: new Date(),
          nextPollAt: new Date(Date.now() + 3000),
          pollAttempts: { increment: 1 },
        },
      });
      await delay(3000, ctx.signal).catch(() => undefined);
    }
  }
  async resume(id: string) {
    try {
      return await this.wait(id, {
        toolCallId: 'reconciler',
        signal: new AbortController().signal,
      });
    } catch (error) {
      const row = await this.prisma.videoGenerationTask.findUniqueOrThrow({ where: { id } });
      return this.fail(row, error);
    }
  }
  async cancel(row: VideoGenerationTask) {
    await this.prisma.videoGenerationTask.updateMany({
      where: { id: row.id, status: { in: ['PENDING', 'SUBMITTING', 'RUNNING', 'PERSISTING'] } },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        completedAt: new Date(),
        errorCode: 'VIDEO_CANCELLED',
        errorMessage: '用户已停止',
      },
    });
    if (row.providerTaskId) void this.transport.cancel(row.providerTaskId);
    if (row.referenceImageId) await this.inputs.release(row.referenceImageId).catch(() => undefined);
    return this.project(
      await this.prisma.videoGenerationTask.findUniqueOrThrow({ where: { id: row.id } }),
    );
  }
  private async timeout(row: VideoGenerationTask) {
    await this.prisma.videoGenerationTask.update({
      where: { id: row.id },
      data: {
        status: 'TIMED_OUT',
        timedOutAt: new Date(),
        completedAt: new Date(),
        errorCode: 'VIDEO_TIMED_OUT',
        errorMessage: '视频生成超过15分钟',
      },
    });
    if (row.referenceImageId) await this.inputs.release(row.referenceImageId).catch(() => undefined);
    return this.project(
      await this.prisma.videoGenerationTask.findUniqueOrThrow({ where: { id: row.id } }),
    );
  }
  private async persist(row: VideoGenerationTask, url: string, signal?: AbortSignal) {
    const bytes = await this.download(url, signal);
    const path = `${OUTPUT}/${row.videoId}.mp4`;
    const file = await this.sandboxes.writeFile({
      sandboxId: row.sandboxId!,
      path,
      bytes,
      ...(signal ? { signal } : {}),
    });
    const done = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.videoGenerationTask.updateMany({
        where: { id: row.id, status: 'PERSISTING' },
        data: {
          status: 'SUCCEEDED',
          sandboxPath: path,
          mimeType: 'video/mp4',
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          providerFinalStatus: 'SUCCEEDED',
          providerResultUrl: null,
          completedAt: new Date(),
        },
      });
      if (updated.count === 0)
        return tx.videoGenerationTask.findUniqueOrThrow({ where: { id: row.id } });
      await tx.requestLog.update({
        where: { id: row.requestLogId },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          durationMs: row.startedAt ? Date.now() - row.startedAt.getTime() : null,
        },
      });
      await tx.billingRecord.upsert({
        where: { requestLogId: row.requestLogId },
        create: {
          requestLogId: row.requestLogId,
          usageUnknown: true,
          estimatedCostCny: row.estimatedCostCny,
        },
        update: { usageUnknown: true, estimatedCostCny: row.estimatedCostCny },
      });
      return tx.videoGenerationTask.findUniqueOrThrow({ where: { id: row.id } });
    });
    if (row.referenceImageId) await this.inputs.release(row.referenceImageId).catch(() => undefined);
    return this.project(done);
  }
  private async download(raw: string, signal?: AbortSignal) {
    let lastError: unknown;
    for (const pauseMs of [0, 1500, 4000]) {
      if (pauseMs > 0) await abortableDelay(pauseMs, signal);
      try {
        return await this.downloadOnce(raw, signal);
      } catch (error) {
        lastError = error;
        if (!(error instanceof VideoResultDownloadError) || !error.retryable) throw error;
      }
    }
    throw lastError;
  }
  private async downloadOnce(raw: string, signal?: AbortSignal) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || isIP(url.hostname))
      throw new Error('视频结果地址不受信任');
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address)))
      throw new Error('视频结果地址解析到非公网地址');
    let res: Response;
    try {
      res = await fetch(url, { ...(signal ? { signal } : {}), redirect: 'error' });
    } catch (error) {
      throw new VideoResultDownloadError(
        `视频结果下载网络失败${error instanceof Error ? `：${error.message}` : ''}`,
        true,
      );
    }
    if (!res.ok || !res.body)
      throw new VideoResultDownloadError(
        `视频结果下载失败（HTTP ${res.status}）`,
        res.status === 404 ||
          res.status === 408 ||
          res.status === 425 ||
          res.status === 429 ||
          res.status >= 500,
      );
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > this.maxBytes) throw new Error('视频结果超过500MB');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > this.maxBytes) throw new Error('视频结果超过500MB');
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof Error && error.message === '视频结果超过500MB') throw error;
      throw new VideoResultDownloadError(
        `视频结果读取中断${error instanceof Error ? `：${error.message}` : ''}`,
        true,
      );
    }
    const out = Buffer.concat(chunks);
    if (out.length < 12 || out.subarray(4, 8).toString() !== 'ftyp')
      throw new Error('视频结果不是有效MP4');
    return out;
  }
  private async fail(row: VideoGenerationTask, e: unknown) {
    const failed = await this.prisma.videoGenerationTask.updateMany({
      where: { id: row.id, status: row.status },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorCode: 'VIDEO_GENERATION_FAILED',
        errorMessage: e instanceof Error ? e.message : '视频生成失败',
      },
    });
    if (failed.count > 0) {
      await this.prisma.requestLog.updateMany({
        where: { id: row.requestLogId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorCode: 'VIDEO_GENERATION_FAILED',
          errorMessage: e instanceof Error ? e.message : '视频生成失败',
        },
      });
      if (row.referenceImageId)
        await this.inputs.release(row.referenceImageId).catch(() => undefined);
    }
    const updated = await this.prisma.videoGenerationTask.findUniqueOrThrow({
      where: { id: row.id },
    });
    return this.project(updated);
  }
  project(row: VideoGenerationTask): VideoGenerationToolResult {
    const settings = readSettings(row.options);
    return {
      taskId: row.taskId,
      videoId: row.videoId,
      status: row.status.toLowerCase() as VideoGenerationToolResult['status'],
      originalPrompt: row.prompt,
      effectivePrompt: row.effectivePrompt,
      settings: { ...settings, inputMode: row.inputMode as 'text' | 'first_frame' },
      previewUrl: row.status === 'SUCCEEDED' ? `/api/v1/agent/videos/${row.videoId}/content` : null,
      saveUrl: row.status === 'SUCCEEDED' ? `/api/v1/agent/videos/${row.videoId}/save` : null,
      downloadUrl:
        row.status === 'SUCCEEDED' ? `/api/v1/agent/videos/${row.videoId}/download` : null,
      sandboxExpiresAt: row.sandboxExpiresAt?.toISOString() ?? null,
      saved: false,
      creationId: null,
      modelSwitched: Boolean((row.candidateAudit as { switched?: boolean } | null)?.switched),
      suggestions: defaultSuggestions(settings),
      ...(row.errorCode
        ? {
            error: {
              requestId: row.taskId,
              code: row.errorCode,
              message: row.errorMessage ?? '视频生成失败',
              retryable: false,
            },
          }
        : {}),
    };
  }
  async readOwned(userId: string, videoId: string) {
    const task = await this.prisma.videoGenerationTask.findFirst({
      where: { userId, videoId, status: 'SUCCEEDED', sandboxExpiresAt: { gt: new Date() } },
    });
    if (!task?.sandboxId || !task.sandboxPath) throw new NotFoundException('视频不存在或已过期');
    const file = await this.sandboxes.readOutputFile(task.sandboxId, task.sandboxPath);
    if (!file) throw new NotFoundException('视频不存在或已过期');
    return { task, file };
  }
}

function isPrivateAddress(address: string) {
  if (address === '::1' || address === '::' || address.startsWith('fc') || address.startsWith('fd'))
    return true;
  if (address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb'))
    return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4) return false;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}
function readSettings(v: unknown): {
  durationSeconds: number;
  resolution: '540p' | '720p' | '1080p';
  aspectRatio: '16:9' | '9:16' | '1:1';
  audio: boolean;
} {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    durationSeconds: integer(r.durationSeconds) ?? 5,
    resolution: r.resolution === '540p' || r.resolution === '1080p' ? r.resolution : '720p',
    aspectRatio: r.aspectRatio === '9:16' || r.aspectRatio === '1:1' ? r.aspectRatio : '16:9',
    audio: typeof r.audio === 'boolean' ? r.audio : true,
  };
}
function integer(v: unknown) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 60 ? v : undefined;
}
function defaultSuggestions(s: ReturnType<typeof readSettings>): VideoGenerationSuggestion[] {
  return [
    { label: '镜头拉近', prompt: '将镜头缓慢推进并聚焦主体，其他内容保持不变' },
    {
      label: s.aspectRatio === '9:16' ? '改成横屏' : '改成竖屏',
      prompt:
        s.aspectRatio === '9:16'
          ? '改为16:9横屏，其他内容保持不变'
          : '改为9:16竖屏，其他内容保持不变',
    },
    {
      label: s.audio ? '关闭音频' : '开启音频',
      prompt: s.audio ? '关闭音频，其他内容保持不变' : '开启音频，其他内容保持不变',
    },
  ];
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason);
  return delay(ms, signal);
}
