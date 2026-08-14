import { openAICompatibleUsageDetails } from './openai-compatible-usage'

describe('openAICompatibleUsageDetails', () => {
  it('normalizes nested cache and reasoning usage', () => {
    expect(
      openAICompatibleUsageDetails(
        {
          prompt_tokens_details: { cached_tokens: 18 },
          completion_tokens_details: { reasoning_tokens: 7 },
        },
        'Fixture',
        (message) => new Error(message),
      ),
    ).toEqual({ cachedInputTokens: 18, reasoningTokens: 7 })
  })

  it('keeps unsupported usage dimensions unavailable', () => {
    expect(openAICompatibleUsageDetails({}, 'Fixture', (message) => new Error(message))).toEqual({
      cachedInputTokens: null,
      reasoningTokens: null,
    })
  })
})
