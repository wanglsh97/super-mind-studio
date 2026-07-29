import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { RateLimitService } from '../rate-limit/rate-limit.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  FIXTURE_GITHUB_ID,
  FIXTURE_USER_IDENTITY,
  provisionFixtureUserSession,
} from '../user-auth/user-auth.e2e-helpers'
import type { AIGatewayClient } from '@supermind/sdk'

const databaseUrl = process.env.TEST_DATABASE_URL

describe('Public/admin Prompt privacy E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let client: AIGatewayClient

  beforeAll(async () => {
    if (!databaseUrl || (!databaseUrl.includes('_test') && !databaseUrl.includes('test_'))) {
      throw new Error('TEST_DATABASE_URL 必须指向名称包含 _test 或 test_ 的 PostgreSQL 测试库')
    }
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitService)
      .useValue({
        consumeChat: jest.fn().mockResolvedValue(undefined),
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
    await prisma.adminAuditLog.deleteMany()
    await cleanupUserTestData(prisma)
    client = createAuthenticatedClient(baseUrl, await provisionFixtureUserSession(app))
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.adminAuditLog.deleteMany()
      await cleanupUserTestData(prisma)
    }
    if (app) await app.close()
  })

  it('keeps full Prompt out of aggregates and blocks every public admin data endpoint', async () => {
    const secretPrompt = 'PRIVATE_PROMPT_BOUNDARY_7f46d67d'
    const publicResult = await client.prompts.optimize({
      prompt: secretPrompt,
      mode: 'expand',
    })
    expect(JSON.stringify(publicResult)).not.toContain(FIXTURE_USER_IDENTITY.email)

    for (const path of [
      '/api/v1/admin/auth/session',
      '/api/v1/admin/dashboard/overview',
      '/api/v1/admin/dashboard/trends',
      '/api/v1/admin/dashboard/latencies',
      '/api/v1/admin/dashboard/errors',
      '/api/v1/admin/dashboard/token-analytics',
      '/api/v1/admin/logs',
      '/api/v1/admin/tables',
    ]) {
      const response = await fetch(`${baseUrl}${path}`)
      expect(response.status).toBe(401)
    }

    const login = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: '123456' }),
    })
    expect(login.status).toBe(201)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy()

    const usernameLogsResponse = await fetch(
      `${baseUrl}/api/v1/admin/logs?authProvider=GITHUB&userName=FIXTURE-OCTOCAT`,
      { headers: { cookie: cookie ?? '' } },
    )
    expect(usernameLogsResponse.status).toBe(200)
    const usernameLogs = (await usernameLogsResponse.json()) as {
      total: number
      items: Array<{
        requestId: string
        user: {
          id: string
          authProvider: string
          userName: string
          avatarUrl: string | null
        }
      }>
    }
    expect(usernameLogs.total).toBe(1)
    expect(usernameLogs.items[0]?.user).toMatchObject({
      id: expect.any(String),
      authProvider: 'GITHUB',
      userName: FIXTURE_USER_IDENTITY.userName,
      avatarUrl: FIXTURE_USER_IDENTITY.avatarUrl,
    })
    expect(JSON.stringify(usernameLogs)).not.toContain(FIXTURE_USER_IDENTITY.email)
    expect(JSON.stringify(usernameLogs)).not.toContain(secretPrompt)

    const providerIdLogsResponse = await fetch(
      `${baseUrl}/api/v1/admin/logs?providerUserId=${FIXTURE_GITHUB_ID}`,
      { headers: { cookie: cookie ?? '' } },
    )
    expect(providerIdLogsResponse.status).toBe(200)
    await expect(providerIdLogsResponse.json()).resolves.toMatchObject({ total: 1 })

    const detailResponse = await fetch(
      `${baseUrl}/api/v1/admin/logs/${usernameLogs.items[0]?.requestId}`,
      { headers: { cookie: cookie ?? '' } },
    )
    expect(detailResponse.status).toBe(200)
    const detailBody = await detailResponse.json()
    expect(detailBody).toMatchObject({
      user: {
        authProvider: 'GITHUB',
        providerUserId: FIXTURE_GITHUB_ID,
        userName: FIXTURE_USER_IDENTITY.userName,
      },
    })
    expect(JSON.stringify(detailBody)).not.toContain(FIXTURE_USER_IDENTITY.email)

    for (const path of ['overview', 'trends', 'latencies', 'errors', 'token-analytics']) {
      const response = await fetch(`${baseUrl}/api/v1/admin/dashboard/${path}`, {
        headers: { cookie: cookie ?? '' },
      })
      expect(response.status).toBe(200)
      const responseBody = await response.text()
      expect(responseBody).not.toContain(secretPrompt)
      expect(responseBody).not.toContain(FIXTURE_USER_IDENTITY.email)
    }
  })
})
