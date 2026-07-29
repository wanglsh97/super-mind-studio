import type { AgentThread } from '@supermind/sdk'

export function threadTokenUsagePercentage(usage: AgentThread['tokenUsage']): number | null {
  if (usage.contextWindowTokens === null) return null
  return Math.min(
    999,
    Math.round((usage.totalTokens / Math.max(1, usage.contextWindowTokens)) * 100),
  )
}
