import { Injectable } from '@nestjs/common'

import type {
  ChatAdapterMessage,
  ChatAdapterToolDefinition,
} from '../../chat/adapters/chat-adapter'
import { calculateAgentContextBudget } from './agent-context-budget'
import type { AgentContextBudget } from './agent-context-budget'
import { compressAgentContext } from './agent-context-compressor'
import { AgentTokenEstimator } from './agent-token-estimator'

export interface PreparedAgentContext {
  messages: ChatAdapterMessage[]
  budget: AgentContextBudget
  compressionNotes: string[]
  appliedCompressionLevel: 'none' | 'light' | 'moderate'
}

@Injectable()
export class AgentContextPreparer {
  private readonly estimator = new AgentTokenEstimator()

  prepare(input: {
    contextWindowTokens: number
    messages: readonly ChatAdapterMessage[]
    tools: readonly ChatAdapterToolDefinition[]
    maxOutputTokens?: number
  }): PreparedAgentContext {
    const before = calculateAgentContextBudget({ ...input, estimator: this.estimator })
    if (before.level === 'none' || before.level === 'forced') {
      return {
        messages: input.messages.map((message) => ({ ...message })),
        budget: before,
        compressionNotes: [],
        appliedCompressionLevel: 'none',
      }
    }
    const compressed = compressAgentContext(input.messages, before.level)
    const budget = calculateAgentContextBudget({
      ...input,
      messages: compressed.messages,
      estimator: this.estimator,
    })
    return {
      messages: compressed.messages,
      budget,
      compressionNotes: compressed.notes,
      appliedCompressionLevel: before.level,
    }
  }
}
