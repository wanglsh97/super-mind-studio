import type { AgentMessagePart } from '@supermind/sdk'
import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../generated/prisma/client'
import type { AgentMessage, AgentMessageRole } from '../generated/prisma/client'
import { PrismaService } from '../database/prisma.service'

export interface PersistAgentMessageInput {
  threadId: string
  runId: string | null
  role: AgentMessageRole
  parts: AgentMessagePart[]
}

export type AgentMessageWithRunProvider = AgentMessage & {
  run: { provider: string } | null
}

const ROLE_MAP: Record<'user' | 'assistant' | 'tool', AgentMessageRole> = {
  user: 'USER',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
}

/**
 * AgentMessage 持久化端口。消息在 thread 内按连续 `sequence` 排序，parts 以 JSON 表达。
 */
@Injectable()
export class AgentMessageRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listForThread(threadId: string): Promise<AgentMessageWithRunProvider[]> {
    return this.prisma.agentMessage.findMany({
      where: { threadId },
      orderBy: { sequence: 'asc' },
      include: { run: { select: { provider: true } } },
    })
  }

  async appendUserMessage(threadId: string, runId: string, content: string): Promise<AgentMessage> {
    const sequence = await this.nextSequence(threadId)
    return this.prisma.agentMessage.create({
      data: {
        threadId,
        runId,
        role: 'USER',
        sequence,
        parts: [{ type: 'text', text: content }] as unknown as Prisma.InputJsonValue,
      },
    })
  }

  async appendMessages(
    threadId: string,
    runId: string,
    messages: readonly { role: 'user' | 'assistant' | 'tool'; parts: AgentMessagePart[] }[],
  ): Promise<void> {
    if (messages.length === 0) return
    let sequence = await this.nextSequence(threadId)
    await this.prisma.agentMessage.createMany({
      data: messages.map((message) => ({
        threadId,
        runId,
        role: ROLE_MAP[message.role],
        sequence: sequence++,
        parts: message.parts as unknown as Prisma.InputJsonValue,
      })),
    })
  }

  private async nextSequence(threadId: string): Promise<number> {
    const last = await this.prisma.agentMessage.findFirst({
      where: { threadId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    })
    return (last?.sequence ?? -1) + 1
  }
}
