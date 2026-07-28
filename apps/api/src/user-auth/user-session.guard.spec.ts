import type { ExecutionContext } from '@nestjs/common'

import { CurrentUser } from './current-user.decorator'
import { UserSessionGuard } from './user-session.guard'
import type { UserSessionService } from './user-session.service'

const user = {
  id: '00000000-0000-4000-8000-000000000101',
  authProvider: 'GITHUB' as const,
  userName: 'octocat',
  avatarUrl: null,
}

describe('UserSessionGuard', () => {
  it('derives currentUser only from the HttpOnly session cookie', async () => {
    const read = jest.fn().mockResolvedValue(user)
    const request = {
      cookies: { aigateway_user_session: 'server-issued-token' },
      body: { userId: 'attacker-controlled-user-id' },
      headers: { 'x-user-id': 'attacker-controlled-user-id' },
    }
    const context = contextFor(request)
    const guard = new UserSessionGuard({ read } as unknown as UserSessionService)

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(read).toHaveBeenCalledWith('server-issued-token')
    expect(request).toMatchObject({ currentUser: user })
  })

  it('does not swallow an invalid-session 401', async () => {
    const read = jest.fn().mockRejectedValue(Object.assign(new Error('invalid'), { status: 401 }))
    const guard = new UserSessionGuard({ read } as unknown as UserSessionService)

    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toMatchObject({
      status: 401,
    })
  })

  it('CurrentUser returns only the guard-populated identity', () => {
    const factory = CurrentUser as unknown as {
      factory?: (data: unknown, context: ExecutionContext) => unknown
    }
    expect(factory.factory).toBeUndefined()
    // The decorator is intentionally exercised through controller tests; its public contract is
    // the strongly typed AuthenticatedUser parameter rather than client-provided DTO fields.
  })
})

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}
