import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Prisma } from '../generated/prisma/client'
import type { ChatAdapterUsage } from '../adapters/chat-adapter'
import type { ChatAdapterId } from '../chat/chat.constants'
import type { RequestLifecycleUsage } from '../request-lifecycle/request-lifecycle.service'

const PRICE_KEYS = {
  qwen: ['QWEN_INPUT_PRICE_CNY_PER_MILLION', 'QWEN_OUTPUT_PRICE_CNY_PER_MILLION'],
  glm: ['GLM_INPUT_PRICE_CNY_PER_MILLION', 'GLM_OUTPUT_PRICE_CNY_PER_MILLION'],
  deepseek: ['DEEPSEEK_INPUT_PRICE_CNY_PER_MILLION', 'DEEPSEEK_OUTPUT_PRICE_CNY_PER_MILLION'],
  kimi: ['KIMI_INPUT_PRICE_CNY_PER_MILLION', 'KIMI_OUTPUT_PRICE_CNY_PER_MILLION'],
} as const

@Injectable()
export class PricingService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  calculate(provider: ChatAdapterId, usage: ChatAdapterUsage): RequestLifecycleUsage {
    if (usage.usageUnknown || usage.inputTokens === null || usage.outputTokens === null) {
      const priceVersion = this.config.get<string>('PRICING_VERSION')
      return { ...usage, ...(priceVersion === undefined ? {} : { priceVersion }) }
    }

    const [inputKey, outputKey] = PRICE_KEYS[provider]
    const inputPrice = this.config.get<string>(inputKey)
    const outputPrice = this.config.get<string>(outputKey)
    const priceVersion = this.config.get<string>('PRICING_VERSION')
    if (!inputPrice || !outputPrice || !priceVersion) return usage

    const inputCost = tokenCost(usage.inputTokens, inputPrice)
    const outputCost = tokenCost(usage.outputTokens, outputPrice)
    return {
      ...usage,
      priceVersion,
      inputCostCny: inputCost.toFixed(8),
      outputCostCny: outputCost.toFixed(8),
      estimatedCostCny: inputCost.add(outputCost).toFixed(8),
    }
  }
}

function tokenCost(tokens: number, pricePerMillion: string): Prisma.Decimal {
  return new Prisma.Decimal(tokens).mul(pricePerMillion).div(1_000_000)
}
