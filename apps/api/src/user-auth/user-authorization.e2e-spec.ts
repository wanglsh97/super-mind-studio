import type { AddressInfo } from 'node:net';

import type { SuperMindClient } from '@supermind/sdk';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { configureApplication } from '../configure-app';
import { PrismaService } from '../database/prisma.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  FIXTURE_GITHUB_ID,
  provisionFixtureUserSession,
} from './user-auth.e2e-helpers';

describe('Paid capability user authorization E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let clientA: SuperMindClient;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitService)
      .useValue({
        consumeChat: jest.fn().mockResolvedValue(undefined),
        consumeImage: jest.fn().mockResolvedValue(undefined),
        consumeAdminLogin: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    app = testingModule.createNestApplication();
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanupUserTestData(prisma);
    const tokenA = await provisionFixtureUserSession(app);
    clientA = createAuthenticatedClient(baseUrl, tokenA);
  });

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma);
    if (app) await app.close();
  });

  it('rejects anonymous Prompt before persistence or Adapter calls', async () => {
    const response = await fetch(`${baseUrl}/api/v1/prompts/optimize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '匿名 Prompt', mode: 'expand' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(prisma.requestLog.count()).resolves.toBe(0);
    await expect(prisma.imageGenerationTask.count()).resolves.toBe(0);
  });

  it('attributes Prompt logs to the authenticated platform user', async () => {
    const result = await clientA.prompts.optimize({ prompt: '记录用户归属', mode: 'structure' });

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
    });
  });
});
