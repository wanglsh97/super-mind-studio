import type { PrismaService } from '../database/prisma.service'
import type { User } from '../generated/prisma/client'
import { UserService } from './user.service'

const githubUser = {
  id: '00000000-0000-4000-8000-000000000101',
  authProvider: 'GITHUB',
  providerUserId: '12345678',
  userName: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/12345678?v=4',
  email: 'shared@example.test',
  lastLoginAt: new Date('2026-07-27T00:00:00.000Z'),
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
} satisfies User

describe('UserService', () => {
  it('upserts OAuth users by provider and provider user ID', async () => {
    const upsert = jest.fn().mockResolvedValue(githubUser)
    const service = createService({ user: { upsert } })
    const now = new Date('2026-07-28T00:00:00.000Z')

    await service.resolveIdentity(
      {
        authProvider: 'GITHUB',
        providerUserId: '12345678',
        userName: 'octocat-renamed',
        avatarUrl: null,
        email: 'shared@example.test',
      },
      now,
    )

    expect(upsert).toHaveBeenCalledWith({
      where: {
        authProvider_providerUserId: {
          authProvider: 'GITHUB',
          providerUserId: '12345678',
        },
      },
      create: expect.objectContaining({
        authProvider: 'GITHUB',
        providerUserId: '12345678',
        lastLoginAt: now,
      }),
      update: {
        userName: 'octocat-renamed',
        avatarUrl: null,
        email: 'shared@example.test',
        lastLoginAt: now,
      },
    })
  })

  it('does not use email to merge identities from different providers', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValueOnce(githubUser)
      .mockResolvedValueOnce({
        ...githubUser,
        id: '00000000-0000-4000-8000-000000000102',
        authProvider: 'GOOGLE',
        providerUserId: 'google-subject',
      })
    const service = createService({ user: { upsert } })

    await service.resolveIdentity({
      authProvider: 'GITHUB',
      providerUserId: '12345678',
      userName: 'octocat',
      avatarUrl: null,
      email: 'shared@example.test',
    })
    await service.resolveIdentity({
      authProvider: 'GOOGLE',
      providerUserId: 'google-subject',
      userName: 'Octo Cat',
      avatarUrl: null,
      email: 'shared@example.test',
    })

    expect(upsert.mock.calls.map(([input]) => input.where)).toEqual([
      {
        authProvider_providerUserId: {
          authProvider: 'GITHUB',
          providerUserId: '12345678',
        },
      },
      {
        authProvider_providerUserId: {
          authProvider: 'GOOGLE',
          providerUserId: 'google-subject',
        },
      },
    ])
  })

  it('always creates a new anonymous user', async () => {
    const create = jest.fn().mockResolvedValue({
      ...githubUser,
      authProvider: 'ANONYMOUS',
      providerUserId: 'anonymous-1',
      userName: 'Anonymous User',
      email: null,
    })
    const upsert = jest.fn()
    const service = createService({ user: { create, upsert } })

    await service.resolveIdentity({
      authProvider: 'ANONYMOUS',
      providerUserId: 'anonymous-1',
      userName: 'Anonymous User',
      avatarUrl: null,
      email: null,
    })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authProvider: 'ANONYMOUS',
        providerUserId: 'anonymous-1',
      }),
    })
    expect(upsert).not.toHaveBeenCalled()
  })
})

function createService(prisma: object): UserService {
  return new UserService(prisma as PrismaService)
}
