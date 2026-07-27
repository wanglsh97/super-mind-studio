import type { AddressInfo } from 'node:net'

import { AIGatewayTimeoutError } from '@supermind/sdk'
import type { AIGatewayClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { RateLimitService } from '../rate-limit/rate-limit.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  createAuthenticatedFetch,
  provisionFixtureUserSession,
} from '../user-auth/user-auth.e2e-helpers'
import type {
  ImageAdapter,
  ImageAdapterDownloadRequest,
  ImageAdapterStatus,
  ImageAdapterStatusRequest,
  ImageAdapterSubmitRequest,
} from './adapters/image-adapter'
import { IMAGE_ADAPTERS } from './adapters/image-adapter.registry'

const databaseUrl = process.env.TEST_DATABASE_URL

class RestartSafeImageAdapter implements ImageAdapter {
  readonly id = 'mock' as const
  readonly resolvedModel = 'restart-safe-image-v1'

  async submit(request: ImageAdapterSubmitRequest) {
    return {
      providerTaskId: request.prompt.includes('失败') ? 'failure-task' : 'success-task',
      status: 'pending' as const,
    }
  }

  async getStatus(request: ImageAdapterStatusRequest): Promise<ImageAdapterStatus> {
    if (request.providerTaskId === 'failure-task') {
      return {
        status: 'failed' as const,
        errorCode: 'FIXTURE_FAILED',
        errorMessage: 'fixture generation failed',
      }
    }
    return {
      status: 'succeeded' as const,
      results: [{ url: `mock://image/${request.providerTaskId}/0`, contentType: 'image/png' }],
    }
  }

  async download(request: ImageAdapterDownloadRequest) {
    if (!request.url.startsWith('mock://image/')) throw new Error('unexpected fixture URL')
    return { body: Uint8Array.from([137, 80, 78, 71]), contentType: 'image/png' }
  }
}

class NeverCompletesImageAdapter extends RestartSafeImageAdapter {
  override async getStatus() {
    return { status: 'running' as const }
  }
}

describe('Mock Image API/SDK/PostgreSQL E2E', () => {
  let app: INestApplication | undefined
  let client: AIGatewayClient
  let prisma: PrismaService
  let sessionToken = ''
  let authenticatedFetch: typeof fetch

  beforeAll(() => {
    if (!databaseUrl || (!databaseUrl.includes('_test') && !databaseUrl.includes('test_'))) {
      throw new Error('TEST_DATABASE_URL 必须指向名称包含 _test 或 test_ 的 PostgreSQL 测试库')
    }
  })

  beforeEach(async () => {
    sessionToken = ''
    await start(new RestartSafeImageAdapter())
    await cleanupUserTestData(prisma)
    sessionToken = await provisionFixtureUserSession(app!)
    configureAuthenticatedClients()
  })

  afterEach(async () => {
    if (prisma) {
      await cleanupUserTestData(prisma)
    }
    await app?.close()
    app = undefined
    sessionToken = ''
  })

  it('submits, survives an API restart, polls to success and proxies the persisted result', async () => {
    const submitted = await client.images.create({ model: 'wanxiang', prompt: '重启恢复测试' })
    expect(submitted.status).toBe('pending')
    await expect(
      prisma.imageGenerationTask.findUnique({ where: { taskId: submitted.taskId } }),
    ).resolves.toMatchObject({ providerTaskId: 'success-task', status: 'PENDING' })

    await app?.close()
    app = undefined
    await start(new RestartSafeImageAdapter())

    const completed = await client.images.get(submitted.taskId)
    expect(completed).toMatchObject({ status: 'succeeded', results: [{ index: 0 }] })
    const response = await authenticatedFetch(client.images.downloadUrl(submitted.taskId, 0))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([137, 80, 78, 71]))

    const persisted = await prisma.imageGenerationTask.findUnique({
      where: { taskId: submitted.taskId },
      include: { requestLog: { include: { billing: true } } },
    })
    expect(persisted).toMatchObject({
      status: 'SUCCEEDED',
      requestLog: { status: 'SUCCEEDED', billing: { usageUnknown: true } },
    })
  })

  it('persists a normalized provider failure and its request lifecycle', async () => {
    const submitted = await client.images.create({ model: 'wanxiang', prompt: '生成失败' })
    const failed = await client.images.get(submitted.taskId)

    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'FIXTURE_FAILED', message: 'fixture generation failed' },
    })
    await expect(
      prisma.imageGenerationTask.findUnique({
        where: { taskId: submitted.taskId },
        include: { requestLog: { include: { billing: true } } },
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      requestLog: { status: 'FAILED', billing: { usageUnknown: true } },
    })
  })

  it('returns an SDK timeout without changing the persisted server task to failed', async () => {
    await app?.close()
    app = undefined
    await start(new NeverCompletesImageAdapter())
    const submitted = await client.images.create({ model: 'wanxiang', prompt: '保持运行' })

    await expect(
      client.images.wait(submitted.taskId, { timeoutMs: 30, intervalMs: 5 }),
    ).rejects.toBeInstanceOf(AIGatewayTimeoutError)
    await expect(
      prisma.imageGenerationTask.findUnique({ where: { taskId: submitted.taskId } }),
    ).resolves.toMatchObject({ status: 'RUNNING', errorCode: null })
  })

  async function start(adapter: ImageAdapter): Promise<void> {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IMAGE_ADAPTERS)
      .useValue([adapter])
      .overrideProvider(RateLimitService)
      .useValue({ consumeImage: jest.fn().mockResolvedValue(undefined) })
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
    if (sessionToken) {
      client = createAuthenticatedClient(baseUrl, sessionToken)
      authenticatedFetch = createAuthenticatedFetch(sessionToken)
    }
  }

  function configureAuthenticatedClients(): void {
    const address = app!.getHttpServer().address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    client = createAuthenticatedClient(baseUrl, sessionToken)
    authenticatedFetch = createAuthenticatedFetch(sessionToken)
  }
})
