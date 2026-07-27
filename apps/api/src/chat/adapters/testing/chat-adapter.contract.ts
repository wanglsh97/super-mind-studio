import type { ChatFinishReason } from '@supermind/sdk'

import type { ChatAdapterId } from '../../chat.constants'
import type {
  ChatAdapter,
  ChatAdapterError,
  ChatAdapterEvent,
  ChatAdapterRequest,
  ChatAdapterUsage,
} from '../chat-adapter'

interface ChatAdapterContractCase {
  adapter: ChatAdapter
  assertRequest?: (request: ChatAdapterRequest) => Promise<void> | void
}

interface ChatAdapterSuccessContractCase extends ChatAdapterContractCase {
  expectedDeltas: readonly string[]
  expectedUsage: ChatAdapterUsage
  expectedFinishReason: ChatFinishReason
  expectedProviderRequestId?: string
}

interface ChatAdapterErrorContractCase extends ChatAdapterContractCase {
  expectedError: Pick<ChatAdapterError, 'code' | 'retryable'> &
    Partial<Pick<ChatAdapterError, 'statusCode' | 'providerRequestId'>>
}

export interface ChatAdapterContractHarness {
  name: string
  adapterId: ChatAdapterId
  requestOverrides?: Partial<Omit<ChatAdapterRequest, 'signal'>>
  createSuccessCase(): ChatAdapterSuccessContractCase
  createErrorCase(): ChatAdapterErrorContractCase
  createCancellationCase(): ChatAdapterContractCase
}

const DEFAULT_REQUEST: Omit<ChatAdapterRequest, 'signal'> = {
  requestId: '00000000-0000-4000-8000-000000000077',
  modelAlias: 'qwen',
  resolvedModel: 'contract-model-v1',
  messages: [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Reply with a short greeting.' },
  ],
  temperature: 0.7,
  topP: 0.8,
  maxTokens: 321,
}

function createRequest(
  signal: AbortSignal,
  overrides: ChatAdapterContractHarness['requestOverrides'],
): ChatAdapterRequest {
  return { ...DEFAULT_REQUEST, ...overrides, signal }
}

async function collectEvents(
  adapter: ChatAdapter,
  request: ChatAdapterRequest,
): Promise<ChatAdapterEvent[]> {
  const events: ChatAdapterEvent[] = []
  for await (const event of adapter.stream(request)) events.push(event)
  return events
}

export function describeChatAdapterContract(harness: ChatAdapterContractHarness): void {
  describe(`${harness.name} ChatAdapter contract`, () => {
    it('maps the normalized request and emits ordered delta, usage and finish events', async () => {
      const contractCase = harness.createSuccessCase()
      const request = createRequest(new AbortController().signal, harness.requestOverrides)

      const events = await collectEvents(contractCase.adapter, request)

      expect(contractCase.adapter.id).toBe(harness.adapterId)
      expect(events).toEqual([
        ...contractCase.expectedDeltas.map((content) => ({
          type: 'delta' as const,
          content,
          ...(contractCase.expectedProviderRequestId
            ? { providerRequestId: contractCase.expectedProviderRequestId }
            : {}),
        })),
        {
          type: 'usage',
          usage: contractCase.expectedUsage,
          ...(contractCase.expectedProviderRequestId
            ? { providerRequestId: contractCase.expectedProviderRequestId }
            : {}),
        },
        {
          type: 'finish',
          finishReason: contractCase.expectedFinishReason,
          ...(contractCase.expectedProviderRequestId
            ? { providerRequestId: contractCase.expectedProviderRequestId }
            : {}),
        },
      ])
      await contractCase.assertRequest?.(request)
    })

    it('maps provider failures to a stable ChatAdapterError', async () => {
      const contractCase = harness.createErrorCase()
      const request = createRequest(new AbortController().signal, harness.requestOverrides)

      await expect(collectEvents(contractCase.adapter, request)).rejects.toMatchObject({
        name: 'ChatAdapterError',
        ...contractCase.expectedError,
      })
      await contractCase.assertRequest?.(request)
    })

    it('propagates request cancellation as AbortError', async () => {
      const controller = new AbortController()
      const contractCase = harness.createCancellationCase()
      const request = createRequest(controller.signal, harness.requestOverrides)
      const nextEvent = contractCase.adapter.stream(request)[Symbol.asyncIterator]().next()

      controller.abort()

      await expect(nextEvent).rejects.toMatchObject({ name: 'AbortError' })
      await contractCase.assertRequest?.(request)
    })
  })
}
