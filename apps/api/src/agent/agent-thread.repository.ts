import { Inject, Injectable } from '@nestjs/common'

import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../database/prisma.service'

export interface CreateAgentThreadInput {
  userId: string
  title: string
  modelId: string
  provider: string
}

export interface AgentThreadSummaryRow {
  id: string
  title: string
  modelId: string
  provider: string
  sandboxId: string | null
  sandboxStatus: string | null
  sandboxCreatedAt: Date | null
  sandboxLastUsedAt: Date | null
  sandboxExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AgentThreadSandboxRow {
  id: string
  userId: string
  sandboxId: string
  sandboxStatus: string
  sandboxCreatedAt: Date
  sandboxLastUsedAt: Date
  sandboxExpiresAt: Date
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  modelId: true,
  provider: true,
  sandboxId: true,
  sandboxStatus: true,
  sandboxCreatedAt: true,
  sandboxLastUsedAt: true,
  sandboxExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.AgentThreadSelect

/**
 * AgentThread 持久化端口。
 *
 * 所有读取与变更都以 `userId`（当前 GitHub 登录用户）过滤，客户端不能声明或覆盖
 * ownerId；对不属于当前用户的线程一律按“不存在”处理，不泄漏其存在性。
 */
@Injectable()
export class AgentThreadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateAgentThreadInput): Promise<AgentThreadSummaryRow> {
    return this.prisma.agentThread.create({
      data: {
        userId: input.userId,
        title: input.title,
        modelId: input.modelId,
        provider: input.provider,
      },
      select: SUMMARY_SELECT,
    })
  }

  async listForOwner(
    userId: string,
    options: { skip: number; take: number },
  ): Promise<{ rows: AgentThreadSummaryRow[]; total: number }> {
    const where = { userId }
    const [rows, total] = await Promise.all([
      this.prisma.agentThread.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: options.skip,
        take: options.take,
        select: SUMMARY_SELECT,
      }),
      this.prisma.agentThread.count({ where }),
    ])
    return { rows, total }
  }

  async findSummaryForOwner(
    threadId: string,
    userId: string,
  ): Promise<AgentThreadSummaryRow | null> {
    return this.prisma.agentThread.findFirst({
      where: { id: threadId, userId },
      select: SUMMARY_SELECT,
    })
  }

  /** 仅当线程属于该用户时更新标题，返回是否命中。 */
  async renameForOwner(threadId: string, userId: string, title: string): Promise<boolean> {
    const result = await this.prisma.agentThread.updateMany({
      where: { id: threadId, userId },
      data: { title },
    })
    return result.count === 1
  }

  /** 仅当线程属于该用户时删除，级联删除其消息、run、event、tool call。返回是否命中。 */
  async deleteForOwner(threadId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.agentThread.deleteMany({ where: { id: threadId, userId } })
    return result.count === 1
  }

  async touch(threadId: string): Promise<void> {
    await this.prisma.agentThread.updateMany({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    })
  }

  async findSandboxForOwner(
    threadId: string,
    userId: string,
  ): Promise<AgentThreadSandboxRow | null> {
    const row = await this.prisma.agentThread.findFirst({
      where: {
        id: threadId,
        userId,
        sandboxId: { not: null },
        sandboxStatus: { in: ['creating', 'ready', 'idle'] },
        sandboxCreatedAt: { not: null },
        sandboxLastUsedAt: { not: null },
        sandboxExpiresAt: { not: null },
      },
      select: {
        id: true,
        userId: true,
        sandboxId: true,
        sandboxStatus: true,
        sandboxCreatedAt: true,
        sandboxLastUsedAt: true,
        sandboxExpiresAt: true,
      },
    })
    return row as AgentThreadSandboxRow | null
  }

  async markSandboxReady(
    threadId: string,
    userId: string,
    input: { sandboxId: string; createdAt: Date; expiresAt: Date; lastUsedAt?: Date },
  ): Promise<void> {
    const lastUsedAt = input.lastUsedAt ?? new Date()
    await this.prisma.agentThread.updateMany({
      where: { id: threadId, userId },
      data: {
        sandboxId: input.sandboxId,
        sandboxStatus: 'ready',
        sandboxCreatedAt: input.createdAt,
        sandboxLastUsedAt: lastUsedAt,
        sandboxExpiresAt: input.expiresAt,
        sandboxDestroyedAt: null,
      },
    })
  }

  async markSandboxIdle(threadId: string, userId: string, sandboxId: string): Promise<void> {
    await this.prisma.agentThread.updateMany({
      where: { id: threadId, userId, sandboxId },
      data: { sandboxStatus: 'idle', sandboxLastUsedAt: new Date() },
    })
  }

  async clearSandbox(threadId: string, sandboxId: string, destroyedAt = new Date()): Promise<void> {
    await this.prisma.agentThread.updateMany({
      where: { id: threadId, sandboxId },
      data: {
        sandboxId: null,
        sandboxStatus: null,
        sandboxCreatedAt: null,
        sandboxLastUsedAt: null,
        sandboxExpiresAt: null,
        sandboxDestroyedAt: destroyedAt,
      },
    })
  }

  async listOwnedSandboxes(): Promise<AgentThreadSandboxRow[]> {
    const rows = await this.prisma.agentThread.findMany({
      where: {
        sandboxId: { not: null },
        sandboxStatus: { in: ['creating', 'ready', 'idle'] },
        sandboxCreatedAt: { not: null },
        sandboxLastUsedAt: { not: null },
        sandboxExpiresAt: { not: null },
      },
      select: {
        id: true,
        userId: true,
        sandboxId: true,
        sandboxStatus: true,
        sandboxCreatedAt: true,
        sandboxLastUsedAt: true,
        sandboxExpiresAt: true,
      },
    })
    return rows as AgentThreadSandboxRow[]
  }
}
