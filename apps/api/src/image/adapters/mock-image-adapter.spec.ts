import { ImageAdapterError } from './image-adapter'
import { MockImageAdapter } from './mock-image-adapter'

const request = {
  requestId: '00000000-0000-4000-8000-000000000099',
  modelAlias: 'mock-image' as const,
  resolvedModel: 'mock-image-v1',
  prompt: '一只机械猫',
  signal: new AbortController().signal,
}

describe('MockImageAdapter', () => {
  it('deterministically advances through running to a downloadable success fixture', async () => {
    const adapter = new MockImageAdapter({
      outcome: 'success',
      pollsBeforeTerminal: 2,
      failSubmit: false,
    })
    const submission = await adapter.submit(request)

    await expect(
      adapter.getStatus({ providerTaskId: submission.providerTaskId, signal: request.signal }),
    ).resolves.toEqual({ status: 'running' })
    const completed = await adapter.getStatus({
      providerTaskId: submission.providerTaskId,
      signal: request.signal,
    })
    expect(completed).toMatchObject({
      status: 'succeeded',
      results: [{ contentType: 'image/png' }],
    })

    const result = completed.results?.[0]
    expect(result).toBeDefined()
    const download = await adapter.download({ url: result!.url, signal: request.signal })
    expect(download.contentType).toBe('image/png')
    expect(download.body.slice(1, 4)).toEqual(Uint8Array.from([0x50, 0x4e, 0x47]))
  })

  it('supports deterministic submission and terminal generation failures', async () => {
    const submitFailure = new MockImageAdapter({
      outcome: 'success',
      pollsBeforeTerminal: 1,
      failSubmit: true,
    })
    await expect(submitFailure.submit(request)).rejects.toBeInstanceOf(ImageAdapterError)

    const generationFailure = new MockImageAdapter({
      outcome: 'failure',
      pollsBeforeTerminal: 1,
      failSubmit: false,
    })
    const submission = await generationFailure.submit(request)
    await expect(
      generationFailure.getStatus({
        providerTaskId: submission.providerTaskId,
        signal: request.signal,
      }),
    ).resolves.toMatchObject({ status: 'failed', errorCode: 'MOCK_IMAGE_GENERATION_FAILED' })
  })

  it('keeps timeout status pending until cancellation and rejects unsafe fixture URLs', async () => {
    const adapter = new MockImageAdapter({
      outcome: 'timeout',
      pollsBeforeTerminal: 1,
      failSubmit: false,
    })
    const submission = await adapter.submit(request)
    const controller = new AbortController()
    const status = adapter.getStatus({
      providerTaskId: submission.providerTaskId,
      signal: controller.signal,
    })
    controller.abort()

    await expect(status).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      adapter.download({ url: 'https://untrusted.example/image.png', signal: request.signal }),
    ).rejects.toMatchObject({ options: { code: 'MOCK_IMAGE_URL_NOT_ALLOWED' } })
  })
})
