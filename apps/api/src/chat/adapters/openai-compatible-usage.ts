import type { ChatAdapterUsage } from './chat-adapter'

type ProtocolErrorFactory = (message: string) => Error

export function openAICompatibleUsageDetails(
  usage: Record<string, unknown>,
  provider: string,
  protocolError: ProtocolErrorFactory,
): Pick<ChatAdapterUsage, 'cachedInputTokens' | 'reasoningTokens'> {
  const promptDetails = optionalRecord(usage.prompt_tokens_details)
  const completionDetails = optionalRecord(usage.completion_tokens_details)
  const inputDetails = optionalRecord(usage.input_tokens_details)
  const outputDetails = optionalRecord(usage.output_tokens_details)
  return {
    cachedInputTokens: optionalToken(
      firstDefined(
        promptDetails?.cached_tokens,
        inputDetails?.cached_tokens,
        usage.prompt_cache_hit_tokens,
        usage.cached_tokens,
        usage.cache_read_input_tokens,
      ),
      `${provider} cached input tokens`,
      protocolError,
    ),
    reasoningTokens: optionalToken(
      firstDefined(
        completionDetails?.reasoning_tokens,
        outputDetails?.reasoning_tokens,
        usage.reasoning_tokens,
      ),
      `${provider} reasoning tokens`,
      protocolError,
    ),
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}

function optionalToken(
  value: unknown,
  label: string,
  protocolError: ProtocolErrorFactory,
): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw protocolError(`${label} must be a non-negative integer`)
  }
  return value
}
