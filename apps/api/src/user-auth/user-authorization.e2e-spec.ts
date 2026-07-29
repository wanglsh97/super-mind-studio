import type { AddressInfo } from 'node:net'

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
  FIXTURE_GITHUB_ID,
  provisionFixtureUserSession,
} from './user-auth.e2e-helpers'
import { UserSessionService } from './user-session.service'

describe('Paid capability user authorization E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let clientA: AIGatewayClient
  let fetchB: typeof fetch

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitService)
      .useValue({
        consumeChat: jest.fn().mockResolvedValue(undefined),
        consumeImage: jest.fn().mockResolvedValue(undefined),
        consumeAdminLogin: jest.fn().mockResolvedValue(undefined),
      })
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await cleanupUserTestData(prisma)
    const tokenA = await provisionFixtureUserSession(app)
    const sessionB = await app.get(UserSessionService).create({
      authProvider: 'GITHUB',
      providerUserId: '90000002',
      userName: 'fixture-hubot',
      avatarUrl: null,
      email: null,
    })
    clientA = createAuthenticatedClient(baseUrl, tokenA)
    fetchB = createAuthenticatedFetch(sessionB.token)
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('rejects anonymous Image and Prompt before persistence or Adapter calls', async () => {
    const attempts = [
      fetch(`${baseUrl}/api/v1/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'mock-image', prompt: '匿名 Image' }),
      }),
      fetch(`${baseUrl}/api/v1/prompts/optimize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: '匿名 Prompt', mode: 'expand' }),
      }),
    ]

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' })
    }
    await expect(prisma.requestLog.count()).resolves.toBe(0)
    await expect(prisma.imageGenerationTask.count()).resolves.toBe(0)
  })

  it('attributes Prompt logs to the authenticated platform user', async () => {
    const result = await clientA.prompts.optimize({ prompt: '记录用户归属', mode: 'structure' })

    await expect(
      prisma.requestLog.findUnique({
        where: { requestId: result.requestId },
        include: { user: true, billing: true },
      }),
    ).resolves.toMatchObject({
      user: {
        authProvider: 'GITHUB',
        providerUserId: FIXTURE_GITHUB_ID,
        userName: 'fixture-octocat',
      },
      billing: { usageUnknown: false },
    })
  })

  it('returns indistinguishable 404 responses for another user image status and download', async () => {
    const task = await clientA.images.create({ model: 'mock-image', prompt: '仅属于 User A' })

    for (const path of [
      `/api/v1/images/generations/${task.taskId}`,
      `/api/v1/images/generations/${task.taskId}/images/0/download`,
    ]) {
      const response = await fetchB(`${baseUrl}${path}`)
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})
