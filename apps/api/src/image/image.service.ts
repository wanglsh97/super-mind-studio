import type { ImageTask } from '@supermind/sdk'
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { PrismaService } from '../database/prisma.service'
import {
  CreationStatus,
  ImageTaskStatus,
  Prisma,
  RequestCapability,
  RequestStatus,
} from '../generated/prisma/client'
import type { ImageAdapter, ImageAdapterSubmission } from './adapters/image-adapter'
import { ImageAdapterRegistry } from './adapters/image-adapter.registry'
import type { CreateImageGenerationDto } from './dto/create-image-generation.dto'
import { isImageAdapterId, isImageModelAlias } from './image.constants'
import { assertImageTaskTransition, isTerminalImageTaskStatus } from './image-task-state'

@Injectable()
export class ImageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImageAdapterRegistry) private readonly adapters: ImageAdapterRegistry,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async createPending(
    userId: string,
    requestId: string,
    input: CreateImageGenerationDto,
    adapter: ImageAdapter,
    clientIp: string | undefined,
  ) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const log = await transaction.requestLog.create({
          data: {
            userId,
            requestId,
            capability: RequestCapability.IMAGE,
            prompt: { prompt: input.prompt },
            modelAlias: input.model,
            provider: adapter.id,
            resolvedModel: adapter.resolvedModel,
            status: RequestStatus.PENDING,
            stream: false,
            ...(clientIp === undefined ? {} : { clientIp }),
          },
        })
        return transaction.imageGenerationTask.create({
          data: {
            userId,
            requestLogId: log.id,
            prompt: input.prompt,
            modelAlias: input.model,
            provider: adapter.id,
            resolvedModel: adapter.resolvedModel,
            status: ImageTaskStatus.PENDING,
            options: {
              ...(input.size === undefined ? {} : { size: input.size }),
              ...(input.count === undefined ? {} : { count: input.count }),
            },
          },
        })
      })
    } catch (error) {
      throw new ServiceUnavailableException('图片任务记录创建失败，暂不能调用模型', {
        cause: error,
      })
    }
  }

  async recordSubmission(taskId: string, userId: string, submission: ImageAdapterSubmission) {
    const startedAt = new Date()
    if (submission.status !== 'succeeded') {
      const task = await this.findTask(taskId, userId)
      return this.prisma.imageGenerationTask.update({
        where: { id: task.id },
        data: {
          providerTaskId: submission.providerTaskId,
          status:
            submission.status === 'running' ? ImageTaskStatus.RUNNING : ImageTaskStatus.PENDING,
          startedAt,
        },
      })
    }

    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.imageGenerationTask.findFirst({ where: { taskId, userId } })
      if (!task) throw new NotFoundException('图片任务不存在')
      const completedAt = new Date()
      const updated = await transaction.imageGenerationTask.update({
        where: { id: task.id },
        data: {
          providerTaskId: submission.providerTaskId,
          status: ImageTaskStatus.SUCCEEDED,
          results: submission.results.map((result) => ({ ...result })) as Prisma.InputJsonValue,
          startedAt,
          completedAt,
        },
      })
      await transaction.requestLog.update({
        where: { id: task.requestLogId },
        data: {
          status: RequestStatus.SUCCEEDED,
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - task.createdAt.getTime()),
        },
      })
      await transaction.billingRecord.upsert({
        where: { requestLogId: task.requestLogId },
        create: { requestLogId: task.requestLogId, usageUnknown: true },
        update: { usageUnknown: true },
      })
      await upsertImageCreation(transaction, updated)
      return updated
    })
  }

  async get(taskId: string, userId: string, signal: AbortSignal): Promise<ImageTask> {
    let task = await this.findTask(taskId, userId)
    const currentStatus = toPublicStatus(task.status)
    if (isTerminalImageTaskStatus(currentStatus)) return this.toPublicTask(task)
    if (!task.provider || !task.providerTaskId) return this.toPublicTask(task)
    if (!isImageAdapterId(task.provider) || !this.adapters.has(task.provider)) {
      throw new ServiceUnavailableException('图片任务对应的 Provider 当前不可用')
    }

    const status = await this.adapters.get(task.provider).getStatus({
      providerTaskId: task.providerTaskId,
      signal,
    })
    assertImageTaskTransition(currentStatus, status.status)
    const nextStatus = toDatabaseStatus(status.status)
    const completedAt = isTerminalImageTaskStatus(status.status) ? new Date() : undefined

    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.imageGenerationTask.updateMany({
        where: { id: task.id, status: task.status },
        data: {
          status: nextStatus,
          ...(status.results === undefined
            ? {}
            : {
                results: status.results.map((result) => ({
                  ...result,
                })) as Prisma.InputJsonValue,
              }),
          errorCode: status.errorCode ?? null,
          errorMessage: status.errorMessage ?? null,
          lastPolledAt: new Date(),
          ...(completedAt === undefined ? {} : { completedAt }),
        },
      })
      if (updated.count !== 1 || completedAt === undefined) return

      await transaction.requestLog.updateMany({
        where: { id: task.requestLogId, status: RequestStatus.PENDING },
        data: {
          status: status.status === 'succeeded' ? RequestStatus.SUCCEEDED : RequestStatus.FAILED,
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - task.createdAt.getTime()),
          errorCode: status.errorCode ?? null,
          errorMessage: status.errorMessage ?? null,
        },
      })
      await transaction.billingRecord.upsert({
        where: { requestLogId: task.requestLogId },
        create: { requestLogId: task.requestLogId, usageUnknown: true },
        update: { usageUnknown: true },
      })
      await upsertImageCreation(transaction, {
        id: task.id,
        userId: task.userId,
        prompt: task.prompt,
        status: nextStatus,
      })
    })

    task = await this.findTask(taskId, userId)
    return this.toPublicTask(task)
  }

  async download(taskId: string, userId: string, index: number, signal: AbortSignal) {
    if (!Number.isInteger(index) || index < 0) throw new BadRequestException('图片 index 无效')
    const task = await this.findTask(taskId, userId)
    if (task.status !== ImageTaskStatus.SUCCEEDED) {
      throw new BadRequestException('只有成功任务可以下载图片')
    }
    if (!task.provider || !isImageAdapterId(task.provider) || !this.adapters.has(task.provider)) {
      throw new ServiceUnavailableException('图片任务对应的 Provider 当前不可用')
    }
    const result = internalResultAt(task.results, index)
    if (!result) throw new NotFoundException('图片 index 不存在')

    const download = await this.adapters.get(task.provider).download({ url: result.url, signal })
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(download.contentType.toLowerCase())) {
      throw new BadGatewayException('Provider 返回了不支持的图片类型')
    }
    const maxBytes = this.config.get<number>('IMAGE_DOWNLOAD_MAX_BYTES', 10_000_000)
    if (download.body.byteLength > maxBytes) {
      throw new BadGatewayException('Provider 图片超过下载大小限制')
    }
    return download
  }

  private async findTask(taskId: string, userId: string) {
    const task = await this.prisma.imageGenerationTask.findFirst({
      where: { taskId, userId },
      include: { requestLog: { select: { requestId: true } } },
    })
    if (!task) throw new NotFoundException('图片任务不存在')
    return task
  }

  toPublicTask(task: {
    requestLog?: { requestId: string }
    taskId: string
    modelAlias: string
    status: ImageTaskStatus
    results?: unknown
    errorCode?: string | null
    errorMessage?: string | null
    createdAt: Date
    updatedAt: Date
  }): ImageTask {
    if (!isImageModelAlias(task.modelAlias)) {
      throw new ServiceUnavailableException('图片任务包含未知模型 alias')
    }
    const results = parsePublicResults(task.results)
    return {
      taskId: task.taskId,
      model: task.modelAlias,
      status: toPublicStatus(task.status),
      results,
      ...(task.errorCode
        ? {
            error: {
              requestId: task.requestLog?.requestId ?? 'unknown',
              code: task.errorCode,
              message: task.errorMessage ?? '图片生成失败',
              retryable: false,
            },
          }
        : {}),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }
  }
}

async function upsertImageCreation(
  transaction: Prisma.TransactionClient,
  task: { id: string; userId: string; prompt: string; status: ImageTaskStatus },
): Promise<void> {
  const status = task.status === ImageTaskStatus.SUCCEEDED ? CreationStatus.SUCCEEDED : CreationStatus.FAILED
  await transaction.creation.upsert({
    where: { imageTaskId: task.id },
    create: {
      userId: task.userId,
      type: 'IMAGE',
      status,
      title: task.prompt.slice(0, 80) || '图片创作',
      imageTaskId: task.id,
    },
    update: { status, title: task.prompt.slice(0, 80) || '图片创作' },
  })
}

function toPublicStatus(status: ImageTaskStatus): ImageTask['status'] {
  return status.toLowerCase() as ImageTask['status']
}

function toDatabaseStatus(status: ImageTask['status']): ImageTaskStatus {
  return ImageTaskStatus[status.toUpperCase() as keyof typeof ImageTaskStatus]
}

function parsePublicResults(value: unknown): ImageTask['results'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const result = item as Record<string, unknown>
    return [
      {
        index,
        ...(typeof result.width === 'number' ? { width: result.width } : {}),
        ...(typeof result.height === 'number' ? { height: result.height } : {}),
        ...(typeof result.contentType === 'string' ? { contentType: result.contentType } : {}),
      },
    ]
  })
}

function internalResultAt(value: unknown, index: number): { url: string } | undefined {
  if (!Array.isArray(value)) return undefined
  const item: unknown = value[index]
  if (typeof item !== 'object' || item === null) return undefined
  const url = (item as Record<string, unknown>).url
  return typeof url === 'string' && url.length > 0 ? { url } : undefined
}
