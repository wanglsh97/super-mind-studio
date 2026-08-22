import { ConfigService } from '@nestjs/config'

import type { PrismaService } from '../database/prisma.service'
import { UserService } from '../user/user.service'
import { UserSessionService } from './user-session.service'

const user = {
  id: '00000000-0000-4000-8000-000000000101',
  authProvider: 'GITHUB' as const,
  providerUserId: '12345678',
  userName: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/12345678?v=4',
  email: null,
}

describe('UserSessionService', () => {
  it('upserts a user and stores only a token hash with fixed 30-day expiry', async () => {
    const transaction = {
      userSession: { create: jest.fn().mockResolvedValue({}) },
    }
    const prisma = createPrismaMock(transaction)
    const resolveIdentity = jest.fn().mockResolvedValue(user)
    const service = createService(prisma, { resolveIdentity })
    const now = new Date('2026-07-19T00:00:00.000Z')

    const created = await service.create(
      {
        authProvider: user.authProvider,
        providerUserId: user.providerUserId,
        userName: user.userName,
        avatarUrl: user.avatarUrl,
        email: null,
      },
      now,
    )

    expect(created.expiresAt).toEqual(new Date('2026-08-18T00:00:00.000Z'))
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(created.user).not.toHaveProperty('email')
    expect(created.user).toEqual({
      id: user.id,
      authProvider: 'GITHUB',
      userName: 'octocat',
      avatarUrl: user.avatarUrl,
    })
    expect(resolveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ authProvider: 'GITHUB', providerUserId: '12345678' }),
      now,
      transaction,
    )
    expect(transaction.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: user.id,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: created.expiresAt,
      }),
    })
    expect(JSON.stringify(transaction.userSession.create.mock.calls)).not.toContain(created.token)
  })

  it('allows multiple independent sessions for the same user', async () => {
    const transaction = {
      userSession: { create: jest.fn().mockResolvedValue({}) },
    }
    const service = createService(createPrismaMock(transaction), {
      resolveIdentity: jest.fn().mockResolvedValue(user),
    })

    const first = await service.create(user, new Date('2026-07-19T00:00:00.000Z'))
    const second = await service.create(user, new Date('2026-07-19T00:01:00.000Z'))

    expect(first.token).not.toBe(second.token)
    expect(transaction.userSession.create).toHaveBeenCalledTimes(2)
  })

  it('rejects and removes an expired session without sliding expiry', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      userSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-id',
          expiresAt: new Date('2026-07-19T00:00:00.000Z'),
          user,
        }),
        deleteMany,
        update: jest.fn(),
      },
    } as unknown as PrismaService
    const service = createService(prisma)

    await expect(
      service.read('expired-token', new Date('2026-07-19T00:00:00.001Z')),
    ).rejects.toMatchObject({ status: 401 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'session-id' } })
    expect(prisma.userSession.update).not.toHaveBeenCalled()
  })

  it('rejects and revokes a legacy anonymous session', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const update = jest.fn()
    const prisma = {
      userSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'anonymous-session-id',
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
          user: { ...user, authProvider: 'ANONYMOUS' },
        }),
        deleteMany,
        update,
      },
    } as unknown as PrismaService
    const service = createService(prisma)

    await expect(
      service.read('anonymous-token', new Date('2026-07-19T00:00:00.000Z')),
    ).rejects.toMatchObject({ status: 401 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'anonymous-session-id' } })
    expect(update).not.toHaveBeenCalled()
  })

  it('revokes only the presented session token', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const prisma = { userSession: { deleteMany } } as unknown as PrismaService
    const service = createService(prisma)

    await service.revoke('current-device-token')

    expect(deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
  })

  it('detects active sessions and removes expired sessions before login switching', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'active-session',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        user: { authProvider: 'GITHUB' },
      })
      .mockResolvedValueOnce({
        id: 'expired-session',
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        user: { authProvider: 'GITHUB' },
      })
    const prisma = { userSession: { deleteMany, findUnique } } as unknown as PrismaService
    const service = createService(prisma)
    const now = new Date('2026-07-19T00:00:00.000Z')

    await expect(service.hasActiveSession('active-token', now)).resolves.toBe(true)
    await expect(service.hasActiveSession('expired-token', now)).resolves.toBe(false)
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'expired-session' } })
  })

  it('treats a legacy anonymous session as logged out and revokes it', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      userSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'anonymous-session',
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
          user: { authProvider: 'ANONYMOUS' },
        }),
        deleteMany,
      },
    } as unknown as PrismaService
    const service = createService(prisma)

    await expect(
      service.hasActiveSession('anonymous-token', new Date('2026-07-19T00:00:00.000Z')),
    ).resolves.toBe(false)
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'anonymous-session' } })
  })
})

function createService(
  prisma: PrismaService,
  users: Pick<UserService, 'resolveIdentity'> = { resolveIdentity: jest.fn() },
): UserSessionService {
  return new UserSessionService(
    prisma,
    users as UserService,
    new ConfigService({
      USER_SESSION_SECRET: 'fixture-user-session-secret-with-at-least-32-characters',
      USER_SESSION_TTL_SECONDS: 2_592_000,
    }),
  )
}

function createPrismaMock(transaction: object): PrismaService {
  return {
    $transaction: jest.fn(async (callback: (value: object) => unknown) => callback(transaction)),
  } as unknown as PrismaService
}
