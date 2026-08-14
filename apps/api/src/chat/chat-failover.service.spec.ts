import { ConfigService } from '@nestjs/config'

import type { ChatAdapter } from '../adapters/chat-adapter'
import { ChatAdapterError } from '../adapters/chat-adapter'
import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry'
import { ChatFailoverService, isEligibleFailure } from './chat-failover.service'

function adapter(id: ChatAdapter['id']): ChatAdapter {
  return { id, resolvedModel: `${id}-model`, stream: jest.fn() }
}

describe('ChatFailoverService', () => {
  const timeout = new ChatAdapterError('timeout', {
    code: 'UPSTREAM_TIMEOUT',
    retryable: true,
  })

  it('resolves an enabled configured fallback for an eligible single-model failure', () => {
    const glm = adapter('glm')
    const service = new ChatFailoverService(
      new ConfigService({ QWEN_FALLBACK_ALIAS: 'glm' }),
      new ChatAdapterRegistry([adapter('qwen'), glm]),
    )

    expect(service.resolve('qwen', timeout, false)).toBe(glm)
  })

  it('disables fallback for comparison requests, ineligible errors, and disabled aliases', () => {
    const service = new ChatFailoverService(
      new ConfigService({ QWEN_FALLBACK_ALIAS: 'glm' }),
      new ChatAdapterRegistry([adapter('qwen')]),
    )
    const badRequest = new ChatAdapterError('bad request', {
      code: 'UPSTREAM_BAD_REQUEST',
      retryable: false,
      statusCode: 400,
    })

    expect(service.resolve('qwen', timeout, true)).toBeUndefined()
    expect(service.resolve('qwen', badRequest, false)).toBeUndefined()
    expect(service.resolve('qwen', timeout, false)).toBeUndefined()
  })

  it('does not switch for non-retryable 5xx or adapter protocol failures', () => {
    const service = new ChatFailoverService(
      new ConfigService({ QWEN_FALLBACK_ALIAS: 'glm' }),
      new ChatAdapterRegistry([adapter('qwen'), adapter('glm')]),
    )

    expect(
      service.resolve(
        'qwen',
        new ChatAdapterError('not retryable', {
          code: 'UPSTREAM_503',
          retryable: false,
          statusCode: 503,
        }),
        false,
      ),
    ).toBeUndefined()
    expect(
      service.resolve(
        'qwen',
        new ChatAdapterError('protocol', {
          code: 'ADAPTER_PROTOCOL_ERROR',
          retryable: false,
        }),
        false,
      ),
    ).toBeUndefined()
  })

  it('only treats timeout, transport, and 5xx adapter failures as eligible', () => {
    expect(isEligibleFailure(timeout)).toBe(true)
    expect(
      isEligibleFailure(
        new ChatAdapterError('unavailable', {
          code: 'UPSTREAM_503',
          retryable: true,
          statusCode: 503,
        }),
      ),
    ).toBe(true)
    expect(isEligibleFailure(new Error('unknown'))).toBe(false)
  })
})
