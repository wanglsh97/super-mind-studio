import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000
const SAFE_RETURN_PATHS = new Set(['/', '/chat/compare'])
export type OAuthProvider = 'GITHUB' | 'GOOGLE'

interface OAuthStatePayload {
  nonce: string
  provider: OAuthProvider
  returnTo: string
  expiresAt: number
}

export interface CreatedOAuthState {
  state: string
  cookieValue: string
  returnTo: string
}

export class OAuthStateError extends Error {
  constructor(readonly code: 'OAUTH_STATE_INVALID' | 'OAUTH_STATE_EXPIRED') {
    super('OAuth 登录请求已失效，请重新登录')
    this.name = 'OAuthStateError'
  }
}

export class OAuthStateService {
  constructor(
    private readonly secret: string,
    private readonly ttlMs = OAUTH_STATE_TTL_MS,
  ) {}

  create(
    provider: OAuthProvider,
    requestedReturnTo: string | undefined,
    now = Date.now(),
  ): CreatedOAuthState {
    const payload: OAuthStatePayload = {
      nonce: randomBytes(32).toString('base64url'),
      provider,
      returnTo: sanitizeReturnTo(requestedReturnTo),
      expiresAt: now + this.ttlMs,
    }
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return {
      state: payload.nonce,
      cookieValue: `${encodedPayload}.${this.sign(encodedPayload)}`,
      returnTo: payload.returnTo,
    }
  }

  verify(
    provider: OAuthProvider,
    state: string | undefined,
    cookieValue: string | undefined,
    now = Date.now(),
  ): string {
    if (!state || !cookieValue) throw new OAuthStateError('OAUTH_STATE_INVALID')
    const [encodedPayload, signature, extra] = cookieValue.split('.')
    if (!encodedPayload || !signature || extra !== undefined) {
      throw new OAuthStateError('OAUTH_STATE_INVALID')
    }
    if (!safeEqual(signature, this.sign(encodedPayload))) {
      throw new OAuthStateError('OAUTH_STATE_INVALID')
    }

    const payload = parsePayload(encodedPayload)
    if (!safeEqual(state, payload.nonce)) throw new OAuthStateError('OAUTH_STATE_INVALID')
    if (payload.provider !== provider) throw new OAuthStateError('OAUTH_STATE_INVALID')
    if (payload.expiresAt <= now) throw new OAuthStateError('OAUTH_STATE_EXPIRED')
    return sanitizeReturnTo(payload.returnTo)
  }

  private sign(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url')
  }
}

export function sanitizeReturnTo(value: string | undefined): string {
  if (!value) return '/'
  return SAFE_RETURN_PATHS.has(value) ? value : '/'
}

function parsePayload(value: string): OAuthStatePayload {
  try {
    const payload: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('nonce' in payload) ||
      typeof payload.nonce !== 'string' ||
      !('provider' in payload) ||
      (payload.provider !== 'GITHUB' && payload.provider !== 'GOOGLE') ||
      !('returnTo' in payload) ||
      typeof payload.returnTo !== 'string' ||
      !('expiresAt' in payload) ||
      typeof payload.expiresAt !== 'number'
    ) {
      throw new Error('invalid payload')
    }
    return payload as OAuthStatePayload
  } catch {
    throw new OAuthStateError('OAUTH_STATE_INVALID')
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
