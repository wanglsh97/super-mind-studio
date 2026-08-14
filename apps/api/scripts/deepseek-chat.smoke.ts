import { randomUUID } from 'node:crypto'

import { DeepSeekChatAdapter } from '../src/adapters/deepseek-chat-adapter'
import { defaultUpstreamModelId } from '../src/chat/chat-models.config'
import { OpenAICompatibleChatTransport } from '../src/adapters/openai-compatible-chat.transport'

void main()

async function main(): Promise<void> {
  const apiKey = required('DEEPSEEK_API_KEY')
  const modelId = defaultUpstreamModelId('deepseek')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 65_000)
  try {
    const adapter = new DeepSeekChatAdapter(
      new OpenAICompatibleChatTransport({ timeoutMs: 60_000 }),
      {
        apiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        modelId,
      },
    )
    const output: string[] = []
    let finishReason: string | undefined
    let providerRequestId: string | undefined
    let usageUnknown = true
    for await (const event of adapter.stream({
      requestId: randomUUID(),
      modelAlias: 'deepseek',
      resolvedModel: modelId,
      messages: [{ role: 'user', content: '只回复“OK”，不要补充其他内容。' }],
      signal: controller.signal,
      temperature: 0,
      // Reasoning models may consume part of this budget before emitting visible content.
      maxTokens: 64,
    })) {
      if (event.providerRequestId !== undefined) providerRequestId = event.providerRequestId
      if (event.type === 'delta') output.push(event.content)
      if (event.type === 'usage') usageUnknown = event.usage.usageUnknown
      if (event.type === 'finish') finishReason = event.finishReason
    }
    if (!output.length || finishReason === undefined) {
      throw new Error('DeepSeek smoke response is incomplete')
    }
    console.log(
      JSON.stringify({
        provider: 'deepseek',
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

function required(name: 'DEEPSEEK_API_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the explicit DeepSeek smoke test`)
  return value
}
