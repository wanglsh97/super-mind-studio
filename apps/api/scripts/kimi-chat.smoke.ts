import { randomUUID } from 'node:crypto'

import { KimiChatAdapter } from '../src/adapters/kimi-chat-adapter'
import { defaultUpstreamModelId } from '../src/chat/chat-models.config'
import { OpenAICompatibleChatTransport } from '../src/adapters/openai-compatible-chat.transport'

void main()

async function main(): Promise<void> {
  const apiKey = required('KIMI_API_KEY')
  const modelId = defaultUpstreamModelId('kimi')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const adapter = new KimiChatAdapter(new OpenAICompatibleChatTransport({ timeoutMs: 25_000 }), {
      apiKey,
      baseUrl: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.cn/v1',
      modelId,
    })
    const output: string[] = []
    let finishReason: string | undefined
    let providerRequestId: string | undefined
    let usageUnknown = true
    for await (const event of adapter.stream({
      requestId: randomUUID(),
      modelAlias: 'kimi',
      resolvedModel: modelId,
      messages: [{ role: 'user', content: '只回复“OK”，不要补充其他内容。' }],
      signal: controller.signal,
      maxTokens: 16,
    })) {
      if (event.providerRequestId !== undefined) providerRequestId = event.providerRequestId
      if (event.type === 'delta') output.push(event.content)
      if (event.type === 'usage') usageUnknown = event.usage.usageUnknown
      if (event.type === 'finish') finishReason = event.finishReason
    }
    if (!output.length || finishReason === undefined)
      throw new Error('Kimi smoke response is incomplete')
    console.log(
      JSON.stringify({
        provider: 'kimi',
        modelId,
        providerRequestId: providerRequestId ?? null,
        finishReason,
        usageUnknown,
        output: output.join(''),
      }),
    )
  } finally {
    clearTimeout(timeout)
  }
}

function required(name: 'KIMI_API_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the explicit Kimi smoke test`)
  return value
}
