import type { AuthProvider } from '../generated/prisma/client'

export interface AuthIdentityInput {
  authProvider: AuthProvider
  providerUserId: string
  userName: string
  avatarUrl: string | null
  email: string | null
}

export interface AuthenticatedUser {
  id: string
  authProvider: AuthProvider
  userName: string
  avatarUrl: string | null
}
