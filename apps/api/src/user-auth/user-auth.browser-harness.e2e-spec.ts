import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Express, Response } from 'express'

import { configureApplication } from '../configure-app'
import { RateLimitService } from '../rate-limit/rate-limit.service'
import { GITHUB_OAUTH_CLIENT } from './user-auth.constants'

const describeBrowserHarness = process.env.BROWSER_E2E_HARNESS === 'true' ? describe : describe.skip

describeBrowserHarness('User auth browser E2E harness', () => {
  let app: INestApplication
  let finishHarness!: () => void
  const harnessFinished = new Promise<void>((resolve) => {
    finishHarness = resolve
  })

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'http://localhost:3000'
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3001/api/v1/auth/github/callback'
    const { AppModule } = await import('../app.module')
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitService)
      .useValue({
        consumeChat: jest.fn().mockResolvedValue(undefined),
        consumeImage: jest.fn().mockResolvedValue(undefined),
        consumeAdminLogin: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(GITHUB_OAUTH_CLIENT)
      .useValue({
        authenticate: jest.fn().mockResolvedValue({
          authProvider: 'GITHUB',
          providerUserId: '90000001',
          userName: 'fixture-octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/90000001?v=4',
          email: 'fixture-octocat@example.test',
        }),
      })
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    const express = app.getHttpAdapter().getInstance() as Express
    express.post('/__browser-harness/finish', (_request, response: Response) => {
      response.status(204).end()
      finishHarness()
    })
    await app.listen(3001, '127.0.0.1')
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it(
    'keeps the fixture API available for browser automation',
    async () => {
      process.stdout.write(
        'Browser auth API harness ready on http://localhost:3001; POST http://127.0.0.1:3001/__browser-harness/finish when complete\n',
      )
      await harnessFinished
    },
    10 * 60_000,
  )
})
