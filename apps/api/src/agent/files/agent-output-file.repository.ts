import { Inject, Injectable } from '@nestjs/common'

import type { Prisma, UserFile } from '../../generated/prisma/client'
import { PrismaService } from '../../database/prisma.service'

const RETAINED_STATUSES = ['PENDING_UPLOAD', 'AVAILABLE', 'DELETING', 'CLEANUP_PENDING'] as const

@Injectable()
export class AgentOutputFileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findOutput(runId: string, sandboxPath: string): Promise<UserFile | null> {
    return this.prisma.userFile.findUnique({
      where: {
        runId_direction_sandboxPath: {
          runId,
          direction: 'OUTPUT',
          sandboxPath,
        },
      },
    })
  }

  async reserve(input: {
    id: string
    userId: string
    runId: string
    sandboxPath: string
    name: string
    mimeType: string
    objectKey: string
    sizeBytes: number
    sha256: string
    maxRunBytes: number
    maxUserBytes: number
  }): Promise<UserFile> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.userFile.findUnique({
              where: {
                runId_direction_sandboxPath: {
                  runId: input.runId,
                  direction: 'OUTPUT',
                  sandboxPath: input.sandboxPath,
                },
              },
            })
            if (existing) return existing

            const [runUsage, userUsage] = await Promise.all([
              retainedBytes(tx, { runId: input.runId, direction: 'OUTPUT' }),
              retainedBytes(tx, { userId: input.userId }),
            ])
            const size = BigInt(input.sizeBytes)
            if (runUsage + size > BigInt(input.maxRunBytes)) {
              throw new AgentOutputFileError(
                'OUTPUT_RUN_QUOTA_EXCEEDED',
                `本次运行导出文件总量不能超过 ${formatMiB(input.maxRunBytes)}`,
              )
            }
            if (userUsage + size > BigInt(input.maxUserBytes)) {
              throw new AgentOutputFileError(
                'OUTPUT_USER_QUOTA_EXCEEDED',
                `用户文件总量不能超过 ${formatMiB(input.maxUserBytes)}`,
              )
            }

            return tx.userFile.create({
              data: {
                id: input.id,
                userId: input.userId,
                runId: input.runId,
                sandboxPath: input.sandboxPath,
                direction: 'OUTPUT',
                status: 'PENDING_UPLOAD',
                name: input.name,
                mimeType: input.mimeType,
                objectKey: input.objectKey,
                sizeBytes: size,
                sha256: input.sha256,
              },
            })
          },
          { isolationLevel: 'Serializable' },
        )
      } catch (error) {
        if (prismaErrorCode(error) === 'P2002') {
          const existing = await this.findOutput(input.runId, input.sandboxPath)
          if (existing) return existing
        }
        if (prismaErrorCode(error) !== 'P2034' || attempt === 2) throw error
      }
    }
    throw new AgentOutputFileError('OUTPUT_STORAGE_FAILED', '无法预留产物存储配额', true)
  }

  async markAvailable(id: string): Promise<UserFile> {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.userFile.update({
        where: { id },
        data: { status: 'AVAILABLE' },
      })
      if (file.runId) {
        const outputs = await tx.userFile.findMany({
          where: {
            runId: file.runId,
            direction: 'OUTPUT',
            status: 'AVAILABLE',
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            sandboxPath: true,
          },
        })
        await tx.agentRun.update({
          where: { id: file.runId },
          data: {
            fileManifest: outputs.map((output) => ({
              id: output.id,
              name: output.name,
              mimeType: output.mimeType,
              sizeBytes: Number(output.sizeBytes),
              sha256: output.sha256,
              path: output.sandboxPath,
            })) as Prisma.InputJsonValue,
          },
        })
      }
      return file
    })
  }

  async releaseReservation(id: string): Promise<void> {
    await this.prisma.userFile.deleteMany({ where: { id, status: 'PENDING_UPLOAD' } })
  }

  async findAvailableForOwner(fileId: string, userId: string): Promise<UserFile | null> {
    return this.prisma.userFile.findFirst({
      where: { id: fileId, userId, status: 'AVAILABLE', deletedAt: null },
    })
  }
}

export class AgentOutputFileError extends Error {
  readonly retryable: boolean

  constructor(
    readonly code:
      | 'OUTPUT_FILE_NOT_FOUND'
      | 'OUTPUT_FILE_INVALID'
      | 'OUTPUT_FILE_TOO_LARGE'
      | 'OUTPUT_RUN_QUOTA_EXCEEDED'
      | 'OUTPUT_USER_QUOTA_EXCEEDED'
      | 'OUTPUT_STORAGE_FAILED',
    message: string,
    retryable = false,
  ) {
    super(message)
    this.name = 'AgentOutputFileError'
    this.retryable = retryable
  }
}

async function retainedBytes(
  tx: Prisma.TransactionClient,
  where: { userId?: string; runId?: string; direction?: 'OUTPUT' },
): Promise<bigint> {
  const result = await tx.userFile.aggregate({
    where: {
      ...where,
      status: { in: [...RETAINED_STATUSES] },
    },
    _sum: { sizeBytes: true },
  })
  return result._sum.sizeBytes ?? 0n
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`
}

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
