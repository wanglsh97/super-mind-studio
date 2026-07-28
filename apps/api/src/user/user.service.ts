import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service'
import type { User } from '../generated/prisma/client'
import type { AuthIdentityInput, AuthenticatedUser } from './user.types'

@Injectable()
export class UserService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveIdentity(identity: AuthIdentityInput, now = new Date()): Promise<User> {
    if (identity.authProvider === 'ANONYMOUS') {
      return this.prisma.user.create({
        data: {
          ...identity,
          lastLoginAt: now,
        },
      })
    }

    return this.prisma.user.upsert({
      where: {
        authProvider_providerUserId: {
          authProvider: identity.authProvider,
          providerUserId: identity.providerUserId,
        },
      },
      create: {
        ...identity,
        lastLoginAt: now,
      },
      update: {
        userName: identity.userName,
        avatarUrl: identity.avatarUrl,
        email: identity.email,
        lastLoginAt: now,
      },
    })
  }
}

export function toAuthenticatedUser(user: {
  id: string
  authProvider: AuthIdentityInput['authProvider']
  userName: string
  avatarUrl: string | null
}): AuthenticatedUser {
  return {
    id: user.id,
    authProvider: user.authProvider,
    userName: user.userName,
    avatarUrl: user.avatarUrl,
  }
}
