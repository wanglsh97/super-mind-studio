import type { PrismaService } from '../../database/prisma.service'
import { AgentContextSummaryRepository } from './agent-context-summary.repository'

describe('AgentContextSummaryRepository', () => {
  it('replaces the summary model attribution with the model that generated the next revision', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'summary-1', revision: 2 })
    const repository = new AgentContextSummaryRepository({
      agentContextSummary: { upsert },
    } as unknown as PrismaService)
    const content = {
      userGoals: ['继续当前任务'],
      userConstraints: [],
      decisions: [],
      facts: [],
      openQuestions: [],
      pendingTasks: [],
      toolFindings: [],
      referencedArtifacts: [],
      recentOutcome: '已切换模型',
      compressionNotes: [],
    }

    await repository.saveValid({
      threadId: 'thread-1',
      coveredThroughSequence: 8,
      schemaVersion: 'v1',
      promptHash: 'hash',
      modelId: 'glm-5.2',
      content,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId: 'thread-1' },
        update: expect.objectContaining({
          modelId: 'glm-5.2',
          revision: { increment: 1 },
        }),
      }),
    )
  })
})
