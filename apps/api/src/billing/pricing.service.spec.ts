import { ConfigService } from '@nestjs/config'

import { PricingService } from './pricing.service'

describe('PricingService', () => {
  it('calculates versioned input, output, and total CNY costs to eight decimals', () => {
    const service = new PricingService(
      new ConfigService({
        PRICING_VERSION: '2026-07-v1',
        QWEN_INPUT_PRICE_CNY_PER_MILLION: '2.5',
        QWEN_OUTPUT_PRICE_CNY_PER_MILLION: '10',
      }),
    )

    expect(
      service.calculate('qwen', {
        inputTokens: 1_200,
        outputTokens: 300,
        totalTokens: 1_500,
        usageUnknown: false,
      }),
    ).toEqual({
      inputTokens: 1_200,
      outputTokens: 300,
      totalTokens: 1_500,
      usageUnknown: false,
      priceVersion: '2026-07-v1',
      inputCostCny: '0.00300000',
      outputCostCny: '0.00300000',
      estimatedCostCny: '0.00600000',
    })
  })

  it('does not guess costs when upstream usage is unknown', () => {
    const service = new PricingService(new ConfigService({ PRICING_VERSION: '2026-07-v1' }))

    expect(
      service.calculate('glm', {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        usageUnknown: true,
      }),
    ).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageUnknown: true,
      priceVersion: '2026-07-v1',
    })
  })
})
