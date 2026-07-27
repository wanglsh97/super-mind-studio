import type { AddressInfo } from 'node:net'

import type { AIGatewayClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../app.module'
import { configureApplication } from '../../configure-app'
import { PrismaService } from '../../database/prisma.service'
import {
  cleanupUserTestData,
  createAuthenticatedClient,
  provisionFixtureUserSession,
} from '../../user-auth/user-auth.e2e-helpers'
import { UserSessionService } from '../../user-auth/user-session.service'

describe('Agent Skill market E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  let clientA: AIGatewayClient
  let clientB: AIGatewayClient

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile()
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
      githubId: '90000002',
      githubUsername: 'fixture-hubot',
      displayName: 'Fixture Hubot',
      avatarUrl: null,
      email: null,
    })
    clientA = createAuthenticatedClient(baseUrl, tokenA)
    clientB = createAuthenticatedClient(baseUrl, sessionB.token)
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('persists idempotent add and remove state per user without an enabled toggle', async () => {
    await expect(clientA.agent.skills.list()).resolves.toHaveLength(3)

    await clientA.agent.skills.install('deep-research')
    await clientA.agent.skills.install('deep-research')
    await expect(prisma.userAgentSkill.count()).resolves.toBe(1)

    await expect(clientB.agent.skills.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'deep-research', installed: false })]),
    )

    await clientA.agent.skills.uninstall('deep-research')
    await clientA.agent.skills.uninstall('deep-research')
    await expect(prisma.userAgentSkill.count()).resolves.toBe(0)
  })

  it('rejects anonymous and unknown Skill operations', async () => {
    const anonymous = await fetch(`${baseUrl}/api/v1/agent/skills`)
    expect(anonymous.status).toBe(401)

    await expect(clientA.agent.skills.install('missing-skill')).rejects.toMatchObject({
      status: 404,
    })
  })
})
