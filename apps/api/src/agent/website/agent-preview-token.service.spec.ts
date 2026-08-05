import { NotFoundException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'

import { AgentPreviewTokenService } from './agent-preview-token.service'

describe('AgentPreviewTokenService', () => {
  const config = {
    getOrThrow: jest.fn(() => 'fixture-preview-token-secret-with-32-characters'),
  } as unknown as ConfigService

  it('issues and verifies a bounded preview capability', () => {
    const service = new AgentPreviewTokenService(config)
    const token = service.issue({ runId: 'run-1', userId: 'user-1', port: 4173 })

    expect(service.verify(token)).toMatchObject({ runId: 'run-1', userId: 'user-1', port: 4173 })
  })

  it('rejects a modified preview capability', () => {
    const service = new AgentPreviewTokenService(config)
    const token = service.issue({ runId: 'run-1', userId: 'user-1', port: 4173 })

    expect(() => service.verify(`${token}changed`)).toThrow(NotFoundException)
  })
})
