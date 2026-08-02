import { TelemetryService } from './telemetry.service'

describe('TelemetryService', () => {
  it('preserves a successful operation result', async () => {
    const service = new TelemetryService()

    await expect(
      service.withSpan('agent.run', { requestId: 'request-1', model: 'qwen' }, async () => 'ok'),
    ).resolves.toBe('ok')
  })

  it('does not turn telemetry into a new error boundary', async () => {
    const service = new TelemetryService()
    const failure = new Error('model failure')

    await expect(
      service.withSpan('agent.model.invoke', { errorCode: 'UPSTREAM_TIMEOUT' }, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })
})
