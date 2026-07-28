import { randomUUID } from 'node:crypto'

import type { AuthIdentityInput } from '../user/user.types'

/** Create a one-time identity that cannot be recovered after its Session is lost. */
export function createAnonymousIdentity(): AuthIdentityInput {
  return {
    authProvider: 'ANONYMOUS',
    providerUserId: randomUUID(),
    userName: 'Anonymous User',
    avatarUrl: null,
    email: null,
  }
}
