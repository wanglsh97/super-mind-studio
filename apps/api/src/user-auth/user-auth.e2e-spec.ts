import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { configureApplication } from '../configure-app'
import { PrismaService } from '../database/prisma.service'
import { GITHUB_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from './user-auth.constants'
import { cleanupUserTestData, createAuthenticatedFetch } from './user-auth.e2e-helpers'
import { UserSessionService } from './user-session.service'

const redisIt = process.env.TEST_REDIS_URL ? it : it.skip

describe('GitHub user authentication E2E', () => {
  let app: INestApplication
  let baseUrl: string
  let prisma: PrismaService
  const authenticate = jest.fn().mockResolvedValue({
    authProvider: 'GITHUB',
    providerUserId: '12345678',
    userName: 'octocat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/12345678?v=4',
    email: 'private-octocat@example.test',
  })
  const authenticateGoogle = jest.fn().mockResolvedValue({
    authProvider: 'GOOGLE',
    providerUserId: 'google-subject-123',
    userName: 'Google Octocat',
    avatarUrl: null,
    email: 'private-octocat@example.test',
  })

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GITHUB_OAUTH_CLIENT)
      .useValue({ authenticate })
      .overrideProvider(GOOGLE_OAUTH_CLIENT)
      .useValue({ authenticate: authenticateGoogle })
      .compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    authenticate.mockClear()
    authenticateGoogle.mockClear()
    await cleanupUserTestData(prisma)
  })

  afterAll(async () => {
    if (prisma) await cleanupUserTestData(prisma)
    if (app) await app.close()
  })

  it('completes fixture OAuth, persists a user/session, restores and logs out', async () => {
    const begin = await fetch(`${baseUrl}/api/v1/auth/github?returnTo=%2F`, {
      redirect: 'manual',
    })
    expect(begin.status).toBe(302)
    const stateCookie = cookiePair(begin.headers.get('set-cookie'))
    const authorizeUrl = new URL(begin.headers.get('location') ?? '')
    const state = authorizeUrl.searchParams.get('state')
    expect(stateCookie).toContain('aigateway_github_oauth_state=')
    expect(state).toBeTruthy()

    const callback = await fetch(
      `${baseUrl}/api/v1/auth/github/callback?code=fixture-code&state=${encodeURIComponent(state ?? '')}`,
      { headers: { cookie: stateCookie }, redirect: 'manual' },
    )
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('http://127.0.0.1:3000/')
    const sessionCookie = cookiePair(callback.headers.get('set-cookie'), 'aigateway_user_session')
    expect(sessionCookie).toContain('aigateway_user_session=')

    await expect(
      prisma.user.findUnique({
        where: {
          authProvider_providerUserId: {
            authProvider: 'GITHUB',
            providerUserId: '12345678',
          },
        },
      }),
    ).resolves.toMatchObject({
      userName: 'octocat',
      email: 'private-octocat@example.test',
    })
    await expect(prisma.userSession.count()).resolves.toBe(1)

    const session = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { cookie: sessionCookie },
    })
    expect(session.status).toBe(200)
    const sessionBody = await session.json()
    expect(sessionBody).toMatchObject({
      user: { authProvider: 'GITHUB', userName: 'octocat' },
    })
    expect(JSON.stringify(sessionBody)).not.toContain('private-octocat@example.test')

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    })
    expect(logout.status).toBe(201)
    await expect(prisma.userSession.count()).resolves.toBe(0)
  })

  it('keeps a second device active when the current device logs out', async () => {
    const sessions = app.get(UserSessionService)
    const identity = {
      authProvider: 'GITHUB' as const,
      providerUserId: '12345678',
      userName: 'octocat',
      avatarUrl: null,
      email: null,
    }
    const first = await sessions.create(identity)
    const second = await sessions.create(identity)

    const logout = await createAuthenticatedFetch(first.token)(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
    })
    expect(logout.status).toBe(201)
    expect(await prisma.userSession.count()).toBe(1)

    const remaining = await createAuthenticatedFetch(second.token)(`${baseUrl}/api/v1/auth/session`)
    expect(remaining.status).toBe(200)
    await expect(remaining.json()).resolves.toMatchObject({
      user: { userName: 'octocat' },
    })
  })

  it('creates a new unrecoverable anonymous User on every login', async () => {
    const first = await fetch(`${baseUrl}/api/v1/auth/anonymous`, { method: 'POST' })
    const second = await fetch(`${baseUrl}/api/v1/auth/anonymous`, { method: 'POST' })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const users = await prisma.user.findMany({ where: { authProvider: 'ANONYMOUS' } })
    expect(users).toHaveLength(2)
    expect(users).toEqual([
      expect.objectContaining({ userName: 'Anonymous User' }),
      expect.objectContaining({ userName: 'Anonymous User' }),
    ])
    expect(users[0]?.providerUserId).not.toBe(users[1]?.providerUserId)
  })

  it('keeps GitHub and Google Users separate when their verified email matches', async () => {
    await completeFixtureOAuth(baseUrl, 'github')
    const googleCallback = await completeFixtureOAuth(baseUrl, 'google')

    expect(googleCallback.status).toBe(302)
    expect(authenticateGoogle).toHaveBeenCalledWith('fixture-code')
    await expect(
      prisma.user.findMany({
        where: { email: 'private-octocat@example.test' },
        orderBy: { authProvider: 'asc' },
      }),
    ).resolves.toMatchObject([
      { authProvider: 'GITHUB', providerUserId: '12345678' },
      { authProvider: 'GOOGLE', providerUserId: 'google-subject-123' },
    ])
  })

  it('rejects a fixed-expiry session without extending it', async () => {
    const created = await app.get(UserSessionService).create({
      authProvider: 'GITHUB',
      providerUserId: '12345678',
      userName: 'octocat',
      avatarUrl: null,
      email: null,
    })
    const persisted = await prisma.userSession.findFirstOrThrow({
      where: { user: { authProvider: 'GITHUB', providerUserId: '12345678' } },
      orderBy: { createdAt: 'desc' },
    })
    await prisma.userSession.update({
      where: { id: persisted.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })

    const response = await createAuthenticatedFetch(created.token)(`${baseUrl}/api/v1/auth/session`)
    expect(response.status).toBe(401)
    await expect(prisma.userSession.findUnique({ where: { id: persisted.id } })).resolves.toBeNull()
  })

  redisIt('uses the real Redis limiter after fixture OAuth login', async () => {
    const begin = await fetch(`${baseUrl}/api/v1/auth/github?returnTo=%2Fchat`, {
      redirect: 'manual',
    })
    const stateCookie = cookiePair(begin.headers.get('set-cookie'))
    const state = new URL(begin.headers.get('location') ?? '').searchParams.get('state')
    const callback = await fetch(
      `${baseUrl}/api/v1/auth/github/callback?code=fixture-code&state=${encodeURIComponent(state ?? '')}`,
      { headers: { cookie: stateCookie }, redirect: 'manual' },
    )
    const sessionCookie = cookiePair(callback.headers.get('set-cookie'), 'aigateway_user_session')

    const response = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.100.${(process.pid % 250) + 1}`,
      },
      body: JSON.stringify({
        model: 'qwen',
        messages: [{ role: 'user', content: '真实 Redis 限流验收' }],
        stream: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data: [DONE]')
    expect(authenticate).toHaveBeenCalledWith('fixture-code')
  })
})

function cookiePair(value: string | null, preferredName?: string): string {
  if (!value) return ''
  const cookies = value.split(/,(?=\s*[^;,]+=)/)
  const selected = preferredName
    ? cookies.find((cookie) => cookie.trim().startsWith(`${preferredName}=`))
    : cookies[0]
  return selected?.trim().split(';')[0] ?? ''
}

async function completeFixtureOAuth(
  baseUrl: string,
  provider: 'github' | 'google',
): Promise<Response> {
  const begin = await fetch(`${baseUrl}/api/v1/auth/${provider}?returnTo=%2F`, {
    redirect: 'manual',
  })
  const stateCookie = cookiePair(begin.headers.get('set-cookie'))
  const state = new URL(begin.headers.get('location') ?? '').searchParams.get('state')
  return fetch(
    `${baseUrl}/api/v1/auth/${provider}/callback?code=fixture-code&state=${encodeURIComponent(state ?? '')}`,
    { headers: { cookie: stateCookie }, redirect: 'manual' },
  )
}
