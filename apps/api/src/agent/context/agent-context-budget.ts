import type {
  ChatAdapterMessage,
  ChatAdapterToolDefinition,
} from '../../adapters/chat-adapter'
import type { AgentTokenEstimator } from './agent-token-estimator'

export const AGENT_DEFAULT_MAX_OUTPUT_TOKENS = 4096
export const AGENT_CONTEXT_SAFETY_RESERVE_RATIO = 0.05
export const AGENT_CONTEXT_SAFETY_RESERVE_MIN_TOKENS = 1024

export type AgentContextCompressionLevel = 'none' | 'light' | 'moderate' | 'forced'

export interface AgentContextBudget {
  contextWindowTokens: number
  usableTokens: number
  usedTokens: number
  usageRatio: number
  estimated: boolean
  level: AgentContextCompressionLevel
  reservedOutputTokens: number
  reservedToolTokens: number
  safetyReserveTokens: number
}

export function calculateAgentContextBudget(input: {
  contextWindowTokens: number
  messages: readonly ChatAdapterMessage[]
  tools: readonly ChatAdapterToolDefinition[]
  estimator: AgentTokenEstimator
  maxOutputTokens?: number
}): AgentContextBudget {
  const contextWindowTokens = positiveInteger(input.contextWindowTokens, 'contextWindowTokens')
  const reservedOutputTokens = positiveInteger(
    input.maxOutputTokens ?? AGENT_DEFAULT_MAX_OUTPUT_TOKENS,
    'maxOutputTokens',
  )
  const messageEstimate = input.estimator.messages(input.messages)
  const toolEstimate = input.estimator.tools(input.tools)
  const safetyReserveTokens = Math.max(
    AGENT_CONTEXT_SAFETY_RESERVE_MIN_TOKENS,
    Math.ceil(contextWindowTokens * AGENT_CONTEXT_SAFETY_RESERVE_RATIO),
  )
  const usableTokens = Math.max(
    1,
    contextWindowTokens - reservedOutputTokens - toolEstimate.tokens - safetyReserveTokens,
  )
  const usageRatio = messageEstimate.tokens / usableTokens

  return {
    contextWindowTokens,
    usableTokens,
    usedTokens: messageEstimate.tokens,
    usageRatio,
    estimated: messageEstimate.estimated || toolEstimate.estimated,
    level: compressionLevel(usageRatio),
    reservedOutputTokens,
    reservedToolTokens: toolEstimate.tokens,
    safetyReserveTokens,
  }
}

export function compressionLevel(usageRatio: number): AgentContextCompressionLevel {
  if (!Number.isFinite(usageRatio) || usageRatio < 0) throw new Error('usageRatio 不合法')
  if (usageRatio >= 0.88) return 'forced'
  if (usageRatio >= 0.75) return 'moderate'
  if (usageRatio >= 0.6) return 'light'
  return 'none'
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`)
  return value
}
