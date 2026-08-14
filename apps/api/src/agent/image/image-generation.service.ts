import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

import type {
  GenerateImageToolArguments,
  ImageAspectRatio,
  ImageGenerationToolResult,
  ImageQuality,
} from '@supermind/sdk';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma, type ImageGenerationTask } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SANDBOX_RUNTIME_PORT, type SandboxRuntimePort } from '../sandbox/sandbox-runtime.port';
import type { AgentToolContext } from '../tools/agent-tool';
import { AgentToolExecutionError } from '../tools/agent-tool';
import { BailianAsyncImageTransport, BailianTransportError } from './bailian-image.transport';
import { mapBailianImageRequest, normalizeGenerateImageArgs } from './bailian-image.mapper';
import { ImageModelCatalog, type ImageModelDefinition } from './image-model.catalog';
import { toImageGenerationStatus } from './image-task-state';

const OUTPUT_DIRECTORY = '/workspace/output/images';
const POLL_LIMIT = 300;
const POLL_INTERVAL_MS = 2_000;
const MAX_IMAGE_BYTES = 10_000_000;
const RESULT_HOST_SUFFIXES = ['aliyuncs.com', 'klingai.com', 'vidu.cn'];

@Injectable()
export class ImageGenerationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImageModelCatalog) private readonly catalog: ImageModelCatalog,
    @Inject(BailianAsyncImageTransport) private readonly transport: BailianAsyncImageTransport,
    @Inject(SANDBOX_RUNTIME_PORT) private readonly sandboxes: SandboxRuntimePort,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async resumePersistedTask(taskDbId: string): Promise<ImageGenerationToolResult> {
    const task = await this.prisma.imageGenerationTask.findUniqueOrThrow({
      where: { id: taskDbId },
    });
    const model = this.catalog.resolvePersisted(task.modelAlias);
    return this.waitForCompletion(taskDbId, model, {
      toolCallId: 'reconciler',
      ...(task.agentRunId ? { runId: task.agentRunId } : {}),
      userId: task.userId,
      signal: new AbortController().signal,
    });
  }

  projectPersistedTask(task: ImageGenerationTask): ImageGenerationToolResult {
    return this.project(
      task,
      this.catalog.resolvePersisted(task.modelAlias),
      task.errorCode
        ? {
            code: task.errorCode,
            message: task.errorMessage ?? '图片任务未成功',
            retryable: false,
          }
        : undefined,
    );
  }

  async generate(
    rawArgs: GenerateImageToolArguments,
    context: AgentToolContext,
  ): Promise<ImageGenerationToolResult> {
    if (!context.runId || !context.userId)
      throw new AgentToolExecutionError({
        code: 'IMAGE_RUN_SCOPE_REQUIRED',
        message: '图像工具缺少 Run 上下文',
      });
    if (!this.transport.isConfigured())
      throw new AgentToolExecutionError({
        code: 'IMAGE_GENERATION_DISABLED',
        message: '图像生成功能当前未开放',
      });
    const args = normalizeGenerateImageArgs(rawArgs);
    if (!args.prompt || args.prompt.length > 5_000)
      throw new BadRequestException('图片 Prompt 长度必须为 1–5000 字符');
    const model = this.catalog.resolve(args.model);
    this.catalog.validateSettings(model, args);

    const run = await this.prisma.agentRun.findFirst({
      where: { id: context.runId, userId: context.userId, mode: 'image' },
      include: { thread: { select: { sandboxId: true, sandboxExpiresAt: true } } },
    });
    if (
      !run?.thread.sandboxId ||
      !run.thread.sandboxExpiresAt ||
      run.thread.sandboxExpiresAt <= new Date()
    ) {
      throw new AgentToolExecutionError({
        code: 'IMAGE_SANDBOX_EXPIRED',
        message: '当前 Thread 的 Sandbox 已过期',
      });
    }

    const parent = await this.resolveReference({
      userId: context.userId,
      threadId: run.threadId,
      ...(args.referenceImageId ? { explicitImageId: args.referenceImageId } : {}),
    });
    if (parent && model.id === 'wan-image' && args.quality === '4K') {
      throw new BadRequestException('万相参考图编辑最高支持 2K');
    }
    const reference = parent
      ? await this.prepareReference(parent, model, context.signal)
      : undefined;
    const requestId = randomUUID();
    const imageId = randomUUID();
    const taskId = randomUUID();
    const options = {
      aspectRatio: args.aspectRatio,
      quality: args.quality,
      watermark: args.watermark,
    };

    const task = await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.imageGenerationTask.findFirst({ where: { agentRunId: run.id } });
      if (duplicate)
        throw new AgentToolExecutionError({
          code: 'IMAGE_TOOL_DUPLICATE',
          message: '同一个 Run 只能生成一张图片',
        });
      const toolCall = await tx.agentToolCall.upsert({
        where: { runId_toolCallId: { runId: run.id, toolCallId: context.toolCallId } },
        create: {
          runId: run.id,
          toolCallId: context.toolCallId,
          toolName: 'generate_image',
          args: args as unknown as Prisma.InputJsonValue,
          status: 'RUNNING',
          sandboxId: run.thread.sandboxId,
        },
        update: {},
      });
      const request = await tx.requestLog.create({
        data: {
          requestId,
          userId: context.userId!,
          agentRunId: run.id,
          capability: 'IMAGE',
          prompt: { original: rawArgs.prompt, effective: args.prompt } as Prisma.InputJsonValue,
          modelAlias: model.id,
          provider: 'bailian',
          resolvedModel: model.upstreamModel,
          stream: false,
          metadata: { catalogVersion: this.catalog.version, options } as Prisma.InputJsonValue,
        },
      });
      return tx.imageGenerationTask.create({
        data: {
          taskId,
          requestLogId: request.id,
          userId: context.userId!,
          agentRunId: run.id,
          agentToolCallId: toolCall.id,
          ...(parent ? { parentImageTaskId: parent.id } : {}),
          imageId,
          prompt: rawArgs.prompt,
          effectivePrompt: args.prompt,
          modelAlias: model.id,
          provider: 'bailian',
          resolvedModel: model.upstreamModel,
          options: options as Prisma.InputJsonValue,
          status: 'SUBMITTING',
          sandboxId: run.thread.sandboxId,
          sandboxExpiresAt: run.thread.sandboxExpiresAt,
        },
      });
    });

    context.onProgress?.({
      content: '正在向图片模型提交任务',
      details: { imageGeneration: this.project(task, model) },
    });
    try {
      const submitted = await this.transport.submit({
        path: model.submitPath,
        body: mapBailianImageRequest(model, {
          prompt: args.prompt,
          ...options,
          ...(reference ? { reference } : {}),
        }),
        signal: context.signal,
        asynchronous: model.asynchronous,
      });
      await this.prisma.imageGenerationTask.update({
        where: { id: task.id },
        data: {
          providerTaskId: submitted.taskId,
          status: 'RUNNING',
          startedAt: new Date(),
          nextPollAt: new Date(),
        },
      });
      await this.prisma.requestLog.update({
        where: { id: task.requestLogId },
        data: { providerRequestId: submitted.requestId ?? submitted.taskId },
      });
      if (submitted.resultUrl) {
        const persisted = await this.prisma.imageGenerationTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        return this.persistResult(persisted, model, submitted.resultUrl, context.signal);
      }
    } catch (error) {
      const unknown = error instanceof BailianTransportError && error.outcomeUnknown;
      return this.finishFailure(
        task,
        model,
        unknown ? 'SUBMISSION_UNKNOWN' : context.signal.aborted ? 'CANCELLED' : 'FAILED',
        error,
      );
    }

    return this.waitForCompletion(task.id, model, context);
  }

  async waitForCompletion(
    taskDbId: string,
    model: ImageModelDefinition,
    context: AgentToolContext,
  ): Promise<ImageGenerationToolResult> {
    const interval = POLL_INTERVAL_MS;
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      if (context.signal.aborted) {
        await this.requestCancel(taskDbId);
        const cancelled = await this.prisma.imageGenerationTask.findUniqueOrThrow({
          where: { id: taskDbId },
        });
        return this.project(cancelled, model, {
          code: 'IMAGE_CANCELLED',
          message: '已停止等待；上游可能仍产生费用',
          retryable: false,
        });
      }
      const row = await this.prisma.imageGenerationTask.findUniqueOrThrow({
        where: { id: taskDbId },
      });
      if (!row.providerTaskId) return this.project(row, model);
      if (row.sandboxExpiresAt && row.sandboxExpiresAt <= new Date())
        return this.expire(row, model);
      let snapshot;
      try {
        snapshot = await this.transport.query(row.providerTaskId, context.signal);
      } catch (error) {
        if (!(error instanceof BailianTransportError) || !error.retryable)
          return this.finishFailure(row, model, 'FAILED', error);
        await this.prisma.imageGenerationTask.update({
          where: { id: row.id },
          data: {
            pollAttempts: { increment: 1 },
            lastPolledAt: new Date(),
            nextPollAt: new Date(
              Date.now() + Math.min(30_000, interval * 2 ** Math.min(attempt, 4)),
            ),
            errorCode: error.code,
            errorMessage: error.message,
          },
        });
        await delay(interval, context.signal).catch(() => undefined);
        continue;
      }
      if (snapshot.status === 'FAILED')
        return this.finishFailure(
          row,
          model,
          'FAILED',
          new Error(snapshot.errorMessage ?? '图片生成失败'),
        );
      if (snapshot.status === 'CANCELLED')
        return this.finishFailure(row, model, 'CANCELLED', new Error('图片任务已取消'));
      if (snapshot.status === 'SUCCEEDED') {
        if (!snapshot.resultUrl)
          return this.finishFailure(row, model, 'FAILED', new Error('百炼成功响应缺少图片地址'));
        return this.persistResult(row, model, snapshot.resultUrl, context.signal);
      }
      const status = snapshot.status === 'RUNNING' ? 'RUNNING' : 'PENDING';
      const updated = await this.prisma.imageGenerationTask.update({
        where: { id: row.id },
        data: {
          status,
          pollAttempts: { increment: 1 },
          lastPolledAt: new Date(),
          nextPollAt: new Date(Date.now() + interval),
          errorCode: null,
          errorMessage: null,
        },
      });
      context.onProgress?.({
        content: status === 'RUNNING' ? '图片正在生成' : '图片任务排队中',
        details: { imageGeneration: this.project(updated, model) },
      });
      await delay(interval, context.signal).catch(() => undefined);
    }
    return this.finishFailure(
      await this.prisma.imageGenerationTask.findUniqueOrThrow({ where: { id: taskDbId } }),
      model,
      'FAILED',
      new Error('图片生成等待超时'),
    );
  }

  async requestCancel(taskDbId: string): Promise<void> {
    const task = await this.prisma.imageGenerationTask.update({
      where: { id: taskDbId },
      data: { status: 'CANCEL_REQUESTED', cancelRequestedAt: new Date() },
    });
    if (task.providerTaskId) await this.transport.cancel(task.providerTaskId).catch(() => false);
    await this.prisma.imageGenerationTask.updateMany({
      where: { id: task.id, status: 'CANCEL_REQUESTED' },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await this.finalizeRequest(
      task.requestLogId,
      'CANCELLED',
      modelPrice(this.catalog, task.modelAlias),
      { code: 'IMAGE_CANCELLED', message: '用户停止图片生成；上游可能仍产生费用' },
    );
  }

  async findOwnedImage(userId: string, imageId: string): Promise<ImageGenerationTask> {
    const task = await this.prisma.imageGenerationTask.findFirst({
      where: { imageId, userId, status: 'SUCCEEDED' },
    });
    if (
      !task ||
      !task.sandboxId ||
      !task.sandboxPath ||
      !task.sandboxExpiresAt ||
      task.sandboxExpiresAt <= new Date()
    )
      throw new NotFoundException('图片不存在或已过期');
    return task;
  }

  async readOwnedImage(userId: string, imageId: string, signal?: AbortSignal) {
    const task = await this.findOwnedImage(userId, imageId);
    const file = await this.sandboxes.readOutputFile(task.sandboxId!, task.sandboxPath!, signal);
    if (!file) throw new NotFoundException('图片不存在或已过期');
    return { task, file };
  }

  private async resolveReference(input: {
    userId: string;
    threadId: string;
    explicitImageId?: string;
  }): Promise<ImageGenerationTask | null> {
    const where = {
      userId: input.userId,
      agentRun: { threadId: input.threadId },
      status: 'SUCCEEDED' as const,
      sandboxExpiresAt: { gt: new Date() },
    };
    if (input.explicitImageId) {
      const explicit = await this.prisma.imageGenerationTask.findFirst({
        where: { ...where, imageId: input.explicitImageId },
      });
      if (!explicit)
        throw new AgentToolExecutionError({
          code: 'IMAGE_REFERENCE_INVALID',
          message: '参考图片不存在、已过期或不属于当前 Thread',
        });
      return explicit;
    }
    return this.prisma.imageGenerationTask.findFirst({ where, orderBy: { createdAt: 'desc' } });
  }

  private async prepareReference(
    task: ImageGenerationTask,
    model: ImageModelDefinition,
    signal: AbortSignal,
  ) {
    if (!task.sandboxId || !task.sandboxPath || !task.mimeType)
      throw new AgentToolExecutionError({
        code: 'IMAGE_REFERENCE_INVALID',
        message: '参考图片不可用',
      });
    const file = await this.sandboxes.readOutputFile(task.sandboxId, task.sandboxPath, signal);
    if (!file)
      throw new AgentToolExecutionError({
        code: 'IMAGE_REFERENCE_EXPIRED',
        message: '参考图片已过期',
      });
    const dataUrl = `data:${task.mimeType};base64,${Buffer.from(file.bytes).toString('base64')}`;
    return { dataUrl };
  }

  private async persistResult(
    task: ImageGenerationTask,
    model: ImageModelDefinition,
    url: string,
    signal: AbortSignal,
  ): Promise<ImageGenerationToolResult> {
    await this.prisma.imageGenerationTask.update({
      where: { id: task.id },
      data: { status: 'PERSISTING', providerResultUrl: url },
    });
    if (task.sandboxExpiresAt && task.sandboxExpiresAt <= new Date())
      return this.expire(task, model);
    try {
      const downloaded = await downloadProviderImage(
        url,
        MAX_IMAGE_BYTES,
        RESULT_HOST_SUFFIXES,
        signal,
      );
      const path = `${OUTPUT_DIRECTORY}/${task.imageId}.${downloaded.extension}`;
      const file = await this.sandboxes.writeFile({
        sandboxId: task.sandboxId!,
        path,
        bytes: downloaded.bytes,
        signal,
      });
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.imageGenerationTask.update({
          where: { id: task.id },
          data: {
            status: 'SUCCEEDED',
            sandboxPath: path,
            mimeType: downloaded.mimeType,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            results: { imageId: task.imageId },
            providerResultUrl: null,
            completedAt: new Date(),
          },
        });
        await tx.agentToolCall.updateMany({
          where: { id: task.agentToolCallId!, status: 'RUNNING' },
          data: { status: 'SUCCEEDED', completedAt: new Date() },
        });
        return result;
      });
      await this.finalizeRequest(task.requestLogId, 'SUCCEEDED', model.priceCny);
      return this.project(updated, model);
    } catch (error) {
      return this.finishFailure(task, model, 'FAILED', error);
    }
  }

  private async expire(
    task: ImageGenerationTask,
    model: ImageModelDefinition,
  ): Promise<ImageGenerationToolResult> {
    if (task.providerTaskId) await this.transport.cancel(task.providerTaskId).catch(() => false);
    const updated = await this.prisma.imageGenerationTask.update({
      where: { id: task.id },
      data: {
        status: 'EXPIRED',
        expiredAt: new Date(),
        completedAt: new Date(),
        providerResultUrl: null,
      },
    });
    await this.finalizeRequest(task.requestLogId, 'FAILED', model.priceCny, {
      code: 'IMAGE_SANDBOX_EXPIRED',
      message: 'Sandbox 已过期，图片结果已丢弃',
    });
    return this.project(updated, model, {
      code: 'IMAGE_SANDBOX_EXPIRED',
      message: 'Sandbox 已过期',
      retryable: false,
    });
  }

  private async finishFailure(
    task: ImageGenerationTask,
    model: ImageModelDefinition,
    status: 'FAILED' | 'CANCELLED' | 'SUBMISSION_UNKNOWN',
    error: unknown,
  ): Promise<ImageGenerationToolResult> {
    const code =
      error instanceof BailianTransportError
        ? error.code
        : status === 'SUBMISSION_UNKNOWN'
          ? 'IMAGE_SUBMISSION_UNKNOWN'
          : status === 'CANCELLED'
            ? 'IMAGE_CANCELLED'
            : 'IMAGE_PROVIDER_FAILED';
    const message = error instanceof Error ? error.message : '图片生成失败';
    const updated = await this.prisma.imageGenerationTask.update({
      where: { id: task.id },
      data: {
        status,
        errorCode: code,
        errorMessage: message,
        completedAt: new Date(),
        providerResultUrl: null,
      },
    });
    if (task.agentToolCallId) {
      await this.prisma.agentToolCall.updateMany({
        where: { id: task.agentToolCallId },
        data: {
          status: status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          errorCode: code,
          errorMessage: message,
          completedAt: new Date(),
        },
      });
    }
    await this.finalizeRequest(
      task.requestLogId,
      status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      model.priceCny,
      { code, message },
    );
    return this.project(updated, model, {
      code,
      message,
      retryable: error instanceof BailianTransportError && error.retryable,
    });
  }

  private async finalizeRequest(
    requestLogId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    priceCny: string,
    error?: { code: string; message: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.requestLog.findUnique({ where: { id: requestLogId } });
      if (!request || request.status !== 'PENDING') return;
      await tx.requestLog.update({
        where: { id: requestLogId },
        data: {
          status,
          completedAt: new Date(),
          durationMs: Date.now() - request.startedAt.getTime(),
          ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
        },
      });
      await tx.billingRecord.upsert({
        where: { requestLogId },
        create: {
          requestLogId,
          usageUnknown: false,
          priceVersion: this.config.get<string>('PRICING_VERSION', 'dev-v1'),
          estimatedCostCny: status === 'SUCCEEDED' ? priceCny : '0',
        },
        update: {
          usageUnknown: false,
          priceVersion: this.config.get<string>('PRICING_VERSION', 'dev-v1'),
          estimatedCostCny: status === 'SUCCEEDED' ? priceCny : '0',
        },
      });
    });
  }

  private project(
    task: ImageGenerationTask,
    model: ImageModelDefinition,
    error?: { code: string; message: string; retryable: boolean },
  ): ImageGenerationToolResult {
    const settings = task.options as {
      aspectRatio?: ImageAspectRatio;
      quality?: ImageQuality;
      watermark?: boolean;
    } | null;
    const imageId = task.status === 'SUCCEEDED' ? task.imageId : null;
    const alternatives = this.catalog.capabilities().filter((item) => item.id !== model.id);
    const currentAspectRatio = settings?.aspectRatio ?? '1:1';
    const currentQuality = settings?.quality ?? '2K';
    return {
      taskId: task.taskId,
      imageId,
      status: toImageGenerationStatus(task.status),
      model: model.id,
      modelName: model.name,
      upstreamModel: model.upstreamModel,
      originalPrompt: task.prompt,
      effectivePrompt: task.effectivePrompt ?? task.prompt,
      settings: {
        aspectRatio: currentAspectRatio,
        quality: currentQuality,
        watermark: settings?.watermark ?? false,
      },
      previewUrl: imageId ? `/api/v1/agent/images/${imageId}/content` : null,
      downloadUrl: imageId ? `/api/v1/agent/images/${imageId}/download` : null,
      saveUrl: imageId ? `/api/v1/agent/images/${imageId}/save` : null,
      sandboxExpiresAt: task.sandboxExpiresAt?.toISOString() ?? null,
      saved: false,
      creationId: null,
      alternatives,
      adjustable: ['aspectRatio', 'quality', 'watermark'],
      suggestions: [
        ...model.aspectRatios
          .filter((value) => value !== currentAspectRatio)
          .map((value) => ({
            kind: 'aspectRatio' as const,
            value,
            label: `改为 ${value}`,
            prompt: `请基于上一张图片继续修改，保持画面内容和风格不变，将图片比例调整为 ${value}。`,
          })),
        ...model.qualities
          .filter((value) => value !== currentQuality)
          .map((value) => ({
            kind: 'quality' as const,
            value,
            label: `改为 ${value}`,
            prompt: `请基于上一张图片继续修改，保持画面内容和风格不变，将图片质量调整为 ${value}。`,
          })),
        ...alternatives.map((alternative) => ({
          kind: 'model' as const,
          value: alternative.id,
          label: alternative.name,
          prompt: `请使用 ${alternative.id} 模型，基于上一张图片继续创作，保持画面内容和风格不变。`,
        })),
      ],
      ...(error ? { error: { requestId: task.requestLogId, ...error } } : {}),
    };
  }
}

function modelPrice(catalog: ImageModelCatalog, modelAlias: string): string {
  return catalog.list().find((model) => model.id === modelAlias)?.priceCny ?? '0';
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function downloadProviderImage(
  urlValue: string,
  maxBytes: number,
  allowedHostSuffixes: readonly string[],
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string; extension: string }> {
  let url = new URL(urlValue);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    assertSafeProviderUrl(url, allowedHostSuffixes);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === 3) throw new Error('图片下载重定向无效');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error('图片结果下载失败');
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) throw new Error('图片结果超过大小限制');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('图片结果超过大小限制');
    const detected = detectImage(bytes);
    const contentType = response.headers.get('content-type')?.split(';')[0];
    if (
      !detected ||
      (contentType && !['image/png', 'image/jpeg', 'image/webp'].includes(contentType))
    )
      throw new Error('图片结果类型无效');
    return { bytes, ...detected };
  }
  throw new Error('图片下载失败');
}

function assertSafeProviderUrl(url: URL, allowedHostSuffixes: readonly string[]): void {
  const hostname = url.hostname.toLowerCase();
  const allowed = allowedHostSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    isIP(hostname) !== 0 ||
    hostname === 'localhost' ||
    hostname.endsWith('.local')
  )
    throw new BadRequestException('不安全的图片结果地址');
}

function detectImage(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mimeType: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.slice(8, 12)).toString() === 'WEBP'
  )
    return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}
