import { randomUUID } from 'node:crypto'

import { QwenChatAdapter } from '../src/adapters/qwen-chat-adapter'
import { defaultUpstreamModelId } from '../src/chat/chat-models.config'
import { OpenAICompatibleChatTransport } from '../src/adapters/openai-compatible-chat.transport'

void main()

async function main(): Promise<void> {
  const apiKey = requiredEnvironment('QWEN_API_KEY')
  const modelId = defaultUpstreamModelId('qwen')
  const baseUrl = process.env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('smoke timeout', 'AbortError')),
    30_000,
  )

  try {
    const adapter = new QwenChatAdapter(new OpenAICompatibleChatTransport({ timeoutMs: 25_000 }), {
      apiKey,
      baseUrl,
      modelId,
    })
    const deltas: string[] = []
    let finishReason: string | undefined
    let providerRequestId: string | undefined
    let usageUnknown = true

    for await (const event of adapter.stream({
      requestId: randomUUID(),
      modelAlias: 'qwen',
      resolvedModel: modelId,
      messages: [{ role: 'user', content: '只回复“OK”，不要补充其他内容。' }],
      signal: controller.signal,
      temperature: 0,
      maxTokens: 16,
    })) {
      if (event.providerRequestId !== undefined) providerRequestId = event.providerRequestId
      if (event.type === 'delta') deltas.push(event.content)
      if (event.type === 'usage') usageUnknown = event.usage.usageUnknown
      if (event.type === 'finish') finishReason = event.finishReason
    }

    if (deltas.length === 0 || finishReason === undefined) {
      throw new Error('Qwen smoke failed: stream did not contain content and completion')
    }
    console.log(
      JSON.stringify({
        provider: 'qwen',
        modelId,
        providerRequestId: providerRequestId ?? null,
        finishReason,
        usageUnknown,
        output: deltas.join(''),
      }),
    )
  } finally {
    clearTimeout(timeout)
  }
}

function requiredEnvironment(name: 'QWEN_API_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the explicit Qwen smoke test`)
  return value
}
