export const USER_RETURN_PATHS = ['/agent', '/chat/compare', '/image', '/prompt'] as const

export interface UserSessionProfile {
  id: string
  githubId: string
  githubUsername: string
  displayName: string | null
  avatarUrl: string | null
}

export interface UserSessionResponse {
  user: UserSessionProfile
}

export class UserAuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UserAuthApiError'
  }
}

export function sanitizeUserReturnTo(value: string | null | undefined): string {
  return value && USER_RETURN_PATHS.includes(value as (typeof USER_RETURN_PATHS)[number])
    ? value
    : '/agent'
}

export function githubLoginUrl(returnTo: string | null | undefined): string {
  return `/api/v1/auth/github?returnTo=${encodeURIComponent(sanitizeUserReturnTo(returnTo))}`
}

export function userLoginErrorMessage(error: string | null): string {
  if (error === 'authorization_rejected')
    return 'GitHub authorization was cancelled. Try again when you are ready.'
  if (error === 'oauth_failed')
    return 'GitHub sign-in could not finish. Check your connection and try again.'
  return error ? 'This sign-in request has expired. Start a new GitHub sign-in.' : ''
}

export function getUserSession(
  fetchImplementation: typeof fetch = fetch,
): Promise<UserSessionResponse> {
  return userAuthRequest('/api/v1/auth/session', { method: 'GET' }, fetchImplementation)
}

export function logoutUser(fetchImplementation: typeof fetch = fetch): Promise<{ success: true }> {
  return userAuthRequest('/api/v1/auth/logout', { method: 'POST' }, fetchImplementation)
}

async function userAuthRequest<T>(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<T> {
  const response = await fetchImplementation(url, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init.headers },
  })
  if (!response.ok) {
    let message = response.status === 401 ? '用户会话无效或已过期' : '用户认证请求失败'
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && typeof body.message === 'string') message = body.message
    } catch {
      // Use the status-based fallback for malformed responses.
    }
    throw new UserAuthApiError(response.status, message)
  }
  return (await response.json()) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
