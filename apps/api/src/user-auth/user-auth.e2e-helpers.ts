import { createSuperMindClient, type SuperMindClient } from '@supermind/sdk'
import type { INestApplication } from '@nestjs/common'

import type { PrismaService } from '../database/prisma.service'
import { USER_SESSION_COOKIE } from './user-auth.constants'
import { UserSessionService } from './user-session.service'

export const FIXTURE_GITHUB_ID = '90000001'
export const FIXTURE_USER_IDENTITY = {
  authProvider: 'GITHUB' as const,
  providerUserId: FIXTURE_GITHUB_ID,
  userName: 'fixture-octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/90000001?v=4',
  email: 'fixture-octocat@example.test',
}

export async function provisionFixtureUserSession(app: INestApplication): Promise<string> {
  const created = await app.get(UserSessionService).create(FIXTURE_USER_IDENTITY)
  return created.token
}

export function createAuthenticatedFetch(sessionToken: string): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('cookie', `${USER_SESSION_COOKIE}=${sessionToken}`)
    return fetch(input, { ...init, headers })
  }
}

export function createAuthenticatedClient(baseUrl: string, sessionToken: string): SuperMindClient {
  return createSuperMindClient({ baseUrl, fetch: createAuthenticatedFetch(sessionToken) })
}

export async function cleanupUserTestData(prisma: PrismaService): Promise<void> {
  await prisma.userFile.deleteMany()
  await prisma.userAgentSkill.deleteMany()
  await prisma.skillReview.deleteMany()
  await prisma.skillUploadSession.deleteMany()
  await prisma.skill.deleteMany()
  await prisma.imageGenerationTask.deleteMany()
  await prisma.requestLog.deleteMany()
  await prisma.userSession.deleteMany()
  await prisma.user.deleteMany()
}
