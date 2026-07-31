import type {
  ChatAdapterMessage,
  ChatAdapterToolDefinition,
} from '../../chat/adapters/chat-adapter'
import {
  AGENT_CONTEXT_SAFETY_RESERVE_MIN_TOKENS,
  calculateAgentContextBudget,
  compressionLevel,
} from './agent-context-budget'
import { AgentTokenEstimator } from './agent-token-estimator'

describe('Agent context budget', () => {
  const messages: ChatAdapterMessage[] = [{ role: 'user', content: '你好 world' }]
  const tools: ChatAdapterToolDefinition[] = [
    { name: 'probe', description: 'test', parameters: { type: 'object' } },
  ]

  it('uses an exact tokenizer when supplied', () => {
    const estimator = new AgentTokenEstimator((text) => text.length)
    const result = calculateAgentContextBudget({
      contextWindowTokens: 10_000,
      messages,
      tools,
      estimator,
      maxOutputTokens: 100,
    })

    expect(result.estimated).toBe(false)
    expect(result.safetyReserveTokens).toBe(AGENT_CONTEXT_SAFETY_RESERVE_MIN_TOKENS)
    expect(result.reservedToolTokens).toBe(JSON.stringify(tools).length)
    expect(result.usedTokens).toBe(JSON.stringify(messages[0]).length + 8)
  })

  it('uses a conservative UTF-8 estimate when no tokenizer is available', () => {
    const result = new AgentTokenEstimator().text('你好ab')
    expect(result).toEqual({ tokens: 4, estimated: true })
  })

  it.each([
    [0, 'none'],
    [0.5999, 'none'],
    [0.6, 'light'],
    [0.7499, 'light'],
    [0.75, 'moderate'],
    [0.8799, 'moderate'],
    [0.88, 'forced'],
    [1.2, 'forced'],
  ] as const)('maps ratio %s to %s compression', (ratio, expected) => {
    expect(compressionLevel(ratio)).toBe(expected)
  })

  it('rejects invalid context configuration', () => {
    expect(() =>
      calculateAgentContextBudget({
        contextWindowTokens: 0,
        messages,
        tools,
        estimator: new AgentTokenEstimator(),
      }),
    ).toThrow('contextWindowTokens')
    expect(() => compressionLevel(Number.NaN)).toThrow('usageRatio')
  })
})
