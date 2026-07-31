export interface AdminSession {
  username: 'root'
  expiresAt: string
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

export async function loginAdmin(
  username: string,
  password: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<AdminSession> {
  return adminRequest<AdminSession>(
    '/api/v1/admin/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
    fetchImplementation,
  )
}

export function getAdminSession(fetchImplementation: typeof fetch = fetch): Promise<AdminSession> {
  return adminRequest('/api/v1/admin/auth/session', { method: 'GET' }, fetchImplementation)
}

export function logoutAdmin(fetchImplementation: typeof fetch = fetch): Promise<{ success: true }> {
  return adminRequest('/api/v1/admin/auth/logout', { method: 'POST' }, fetchImplementation)
}

export function redirectToAdminLogin(): void {
  window.location.replace('/admin/login')
}

async function adminRequest<T>(
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
    let message = response.status === 401 ? '管理员会话无效或已过期' : '管理请求失败'
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      // Keep the status-based fallback when the response is not a JSON envelope.
    }
    throw new AdminApiError(response.status, message)
  }
  return (await response.json()) as T
}
