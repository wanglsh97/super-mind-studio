export const USER_RETURN_PATHS = ['/', '/mcp', '/usage'] as const
export type AuthProvider = 'ANONYMOUS' | 'GITHUB' | 'GOOGLE'

export interface UserSessionProfile {
  id: string
  authProvider: AuthProvider
  userName: string
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
    : '/'
}

export function githubLoginUrl(returnTo: string | null | undefined): string {
  return `/api/v1/auth/github?returnTo=${encodeURIComponent(sanitizeUserReturnTo(returnTo))}`
}

export function googleLoginUrl(returnTo: string | null | undefined): string {
  return `/api/v1/auth/google?returnTo=${encodeURIComponent(sanitizeUserReturnTo(returnTo))}`
}

export function loginAnonymously(
  returnTo: string | null | undefined,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ user: UserSessionProfile; returnTo: string }> {
  const path = `/api/v1/auth/anonymous?returnTo=${encodeURIComponent(sanitizeUserReturnTo(returnTo))}`
  return userAuthRequest(path, { method: 'POST' }, fetchImplementation)
}

export function userLoginErrorMessage(error: string | null): string {
  if (error === 'authorization_rejected')
    return 'OAuth authorization was cancelled. Try again when you are ready.'
  if (error === 'oauth_failed')
    return 'OAuth sign-in could not finish. Check your connection and try again.'
  return error ? 'This sign-in request has expired. Start a new sign-in.' : ''
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
