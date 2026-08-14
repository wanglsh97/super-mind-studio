import type { PrismaService } from '../database/prisma.service'
import { AgentMessageRepository } from './agent-message.repository'

describe('AgentMessageRepository', () => {
  it('loads each message Run Provider for cross-provider history filtering', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const repository = new AgentMessageRepository({
      agentMessage: { findMany },
    } as unknown as PrismaService)

    await expect(repository.listForThread('thread-1')).resolves.toEqual([])
    expect(findMany).toHaveBeenCalledWith({
      where: { threadId: 'thread-1' },
      orderBy: { sequence: 'asc' },
      include: { run: { select: { provider: true } } },
    })
  })
})
