import { EventEmitter } from 'node:events'

import type { Request } from 'express'

import type { RateLimitService } from '../rate-limit/rate-limit.service'
import type { ImageAdapter } from './adapters/image-adapter'
import { ImageAdapterRegistry } from './adapters/image-adapter.registry'
import { ImageController } from './image.controller'
import type { ImageService } from './image.service'

const input = { model: 'wanxiang' as const, prompt: '山水画', size: '1024x1024', count: 1 }
const authenticatedUser = {
  id: '00000000-0000-4000-8000-000000000101',
  authProvider: 'GITHUB' as const,
  userName: 'octocat',
  avatarUrl: null,
}

function setup() {
  const submit = jest.fn().mockResolvedValue({ providerTaskId: 'provider-1', status: 'pending' })
  const adapter: ImageAdapter = {
    id: 'mock',
    resolvedModel: 'mock-image-v1',
    submit,
    getStatus: jest.fn(),
    download: jest.fn(),
  }
  const consumeImage = jest.fn().mockResolvedValue(undefined)
  const rateLimit = { consumeImage } as unknown as RateLimitService
  const persisted = {
    taskId: '00000000-0000-4000-8000-000000000111',
    modelAlias: 'wanxiang',
    status: 'PENDING',
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:00.000Z'),
  }
  const createPending = jest.fn().mockResolvedValue(persisted)
  const recordSubmission = jest.fn().mockResolvedValue(persisted)
  const toPublicTask = jest.fn().mockReturnValue({
    taskId: persisted.taskId,
    model: 'wanxiang',
    status: 'pending',
    results: [],
  })
  const download = jest.fn().mockResolvedValue({
    body: Uint8Array.from([1, 2, 3]),
    contentType: 'image/png',
  })
  const images = {
    createPending,
    recordSubmission,
    toPublicTask,
    download,
  } as unknown as ImageService
  const controller = new ImageController(new ImageAdapterRegistry([adapter]), images, rateLimit)
  const request = Object.assign(new EventEmitter(), {
    id: '00000000-0000-4000-8000-000000000112',
    ip: '127.0.0.1',
  }) as unknown as Request & { id: string }

  return { consumeImage, controller, createPending, download, recordSubmission, request, submit }
}

describe('ImageController', () => {
  it('rate limits and persists the platform task before submitting upstream', async () => {
    const { consumeImage, controller, createPending, recordSubmission, request, submit } = setup()

    await expect(controller.create(input, request, authenticatedUser)).resolves.toMatchObject({
      status: 'pending',
    })

    expect(consumeImage.mock.invocationCallOrder[0]).toBeLessThan(
      createPending.mock.invocationCallOrder[0] ?? 0,
    )
    expect(createPending.mock.invocationCallOrder[0]).toBeLessThan(
      submit.mock.invocationCallOrder[0] ?? 0,
    )
    expect(createPending).toHaveBeenCalledWith(
      authenticatedUser.id,
      request.id,
      input,
      expect.objectContaining({ id: 'mock' }),
      '127.0.0.1',
    )
    expect(recordSubmission).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000111',
      authenticatedUser.id,
      {
        providerTaskId: 'provider-1',
        status: 'pending',
      },
    )
  })

  it('does not persist or invoke an adapter when image rate limiting rejects', async () => {
    const { consumeImage, controller, createPending, request, submit } = setup()
    consumeImage.mockRejectedValue(new Error('rate limited'))

    await expect(controller.create(input, request, authenticatedUser)).rejects.toThrow(
      'rate limited',
    )
    expect(createPending).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not invoke upstream when pending persistence fails', async () => {
    const { controller, createPending, request, submit } = setup()
    createPending.mockRejectedValue(new Error('database unavailable'))

    await expect(controller.create(input, request, authenticatedUser)).rejects.toThrow(
      'database unavailable',
    )
    expect(submit).not.toHaveBeenCalled()
  })

  it('sets safe attachment headers for proxied downloads', async () => {
    const { controller, download, request } = setup()
    const response = { set: jest.fn(), send: jest.fn() }

    await controller.download(
      '00000000-0000-4000-8000-000000000111',
      0,
      request,
      response as never,
      authenticatedUser,
    )

    expect(download).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000111',
      authenticatedUser.id,
      0,
      expect.any(AbortSignal),
    )
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'content-type': 'image/png',
        'content-disposition': expect.stringContaining('attachment;'),
        'x-content-type-options': 'nosniff',
      }),
    )
    expect(response.send).toHaveBeenCalledWith(expect.any(Buffer))
  })
})
