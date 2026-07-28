import { createHmac, randomBytes } from 'node:crypto'

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { PrismaService } from '../database/prisma.service'
import { toAuthenticatedUser, UserService } from '../user/user.service'
import type { AuthIdentityInput, AuthenticatedUser } from '../user/user.types'

export type { AuthenticatedUser } from '../user/user.types'

export interface UserSessionResult {
  token: string
  expiresAt: Date
  user: AuthenticatedUser
}

@Injectable()
export class UserSessionService {
  private readonly secret: string
  private readonly ttlSeconds: number

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('USER_SESSION_SECRET')
    this.ttlSeconds = config.getOrThrow<number>('USER_SESSION_TTL_SECONDS')
  }

  async create(identity: AuthIdentityInput, now = new Date()): Promise<UserSessionResult> {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = this.hashToken(token)
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1_000)

    const user = await this.prisma.$transaction(async (transaction) => {
      const persistedUser = await this.users.resolveIdentity(identity, now, transaction)
      await transaction.userSession.create({
        data: { userId: persistedUser.id, tokenHash, expiresAt, lastSeenAt: now },
      })
      return persistedUser
    })

    return { token, expiresAt, user: toAuthenticatedUser(user) }
  }

  async read(token: string | undefined, now = new Date()): Promise<AuthenticatedUser> {
    if (!token) throw invalidSession()
    const tokenHash = this.hashToken(token)
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    })
    if (!session) throw invalidSession()
    if (session.expiresAt <= now) {
      await this.prisma.userSession.deleteMany({ where: { id: session.id } })
      throw invalidSession()
    }

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    })
    return toAuthenticatedUser(session.user)
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return
    await this.prisma.userSession.deleteMany({ where: { tokenHash: this.hashToken(token) } })
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const result = await this.prisma.userSession.deleteMany({ where: { expiresAt: { lte: now } } })
    return result.count
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex')
  }
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException('用户会话无效或已过期')
}
