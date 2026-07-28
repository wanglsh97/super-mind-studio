import type { AuthIdentityInput } from '../user/user.types'

export interface GoogleOAuthClientOptions {
  clientId: string
  clientSecret: string
  callbackUrl: string
  timeoutMs: number
}

export type GoogleHttpClient = (input: string | URL, init?: RequestInit) => Promise<Response>

export class GoogleOAuthError extends Error {
  constructor(
    readonly code:
      | 'GOOGLE_AUTHORIZATION_REJECTED'
      | 'GOOGLE_RESPONSE_INVALID'
      | 'GOOGLE_TIMEOUT'
      | 'GOOGLE_UNAVAILABLE',
    readonly retryable: boolean,
  ) {
    super('Google 登录暂时不可用，请稍后重试')
    this.name = 'GoogleOAuthError'
  }
}

export class GoogleOAuthClient {
  constructor(
    private readonly options: GoogleOAuthClientOptions,
    private readonly httpClient: GoogleHttpClient = fetch,
  ) {}

  async authenticate(code: string): Promise<AuthIdentityInput> {
    const accessToken = await this.exchangeCode(code)
    const profile = await this.fetchProfile(accessToken)
    const email = profile.email_verified === true ? (profile.email ?? null) : null

    return {
      authProvider: 'GOOGLE',
      providerUserId: profile.sub,
      userName: nonEmpty(profile.name) ?? email ?? 'Google User',
      avatarUrl: normalizeGoogleAvatarUrl(profile.picture),
      email,
    }
  }

  private async exchangeCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.options.callbackUrl,
    })
    const response = await this.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const payload = await readJson(response)

    if (!response.ok) throw responseError(response.status)
    if (
      !isRecord(payload) ||
      typeof payload.access_token !== 'string' ||
      payload.access_token.length === 0
    ) {
      throw new GoogleOAuthError('GOOGLE_RESPONSE_INVALID', false)
    }
    return payload.access_token
  }

  private async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await this.request('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    })
    const payload = await readJson(response)

    if (!response.ok) throw responseError(response.status)
    if (!isGoogleProfile(payload)) {
      throw new GoogleOAuthError('GOOGLE_RESPONSE_INVALID', false)
    }
    return payload
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.httpClient(url, {
        ...init,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      if (isAbortError(error)) throw new GoogleOAuthError('GOOGLE_TIMEOUT', true)
      throw new GoogleOAuthError('GOOGLE_UNAVAILABLE', true)
    }
  }
}

interface GoogleProfile {
  sub: string
  name?: string
  picture?: string
  email?: string
  email_verified?: boolean
}

function isGoogleProfile(value: unknown): value is GoogleProfile {
  return (
    isRecord(value) &&
    typeof value.sub === 'string' &&
    value.sub.length > 0 &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.picture === undefined || typeof value.picture === 'string') &&
    (value.email === undefined || typeof value.email === 'string') &&
    (value.email_verified === undefined || typeof value.email_verified === 'boolean')
  )
}

function normalizeGoogleAvatarUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com')
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function responseError(status: number): GoogleOAuthError {
  if (status === 400 || status === 401 || status === 403) {
    return new GoogleOAuthError('GOOGLE_AUTHORIZATION_REJECTED', false)
  }
  return new GoogleOAuthError('GOOGLE_UNAVAILABLE', status === 429 || status >= 500)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new GoogleOAuthError('GOOGLE_RESPONSE_INVALID', false)
  }
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}
