import type { AuthIdentityInput } from '../user/user.types'

export interface GitHubOAuthClientOptions {
  clientId: string
  clientSecret: string
  callbackUrl: string
  timeoutMs: number
}

export type GitHubHttpClient = (input: string | URL, init?: RequestInit) => Promise<Response>

export class GitHubOAuthError extends Error {
  constructor(
    readonly code:
      | 'GITHUB_AUTHORIZATION_REJECTED'
      | 'GITHUB_RESPONSE_INVALID'
      | 'GITHUB_TIMEOUT'
      | 'GITHUB_UNAVAILABLE',
    readonly retryable: boolean,
  ) {
    super('GitHub 登录暂时不可用，请稍后重试')
    this.name = 'GitHubOAuthError'
  }
}

export class GitHubOAuthClient {
  constructor(
    private readonly options: GitHubOAuthClientOptions,
    private readonly httpClient: GitHubHttpClient = fetch,
  ) {}

  async authenticate(code: string): Promise<AuthIdentityInput> {
    const accessToken = await this.exchangeCode(code)
    const [profile, email] = await Promise.all([
      this.fetchProfile(accessToken),
      this.fetchVerifiedPrimaryEmail(accessToken),
    ])

    return {
      authProvider: 'GITHUB',
      providerUserId: String(profile.id),
      userName: profile.login,
      avatarUrl: normalizeGitHubAvatarUrl(profile.avatar_url),
      email,
    }
  }

  private async exchangeCode(code: string): Promise<string> {
    const response = await this.request('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: this.options.callbackUrl,
      }),
    })
    const body = await readJson(response)

    if (!response.ok) throw responseError(response.status)
    if (isRecord(body) && typeof body.error === 'string') {
      throw new GitHubOAuthError('GITHUB_AUTHORIZATION_REJECTED', false)
    }
    if (
      !isRecord(body) ||
      typeof body.access_token !== 'string' ||
      body.access_token.length === 0
    ) {
      throw new GitHubOAuthError('GITHUB_RESPONSE_INVALID', false)
    }

    return body.access_token
  }

  private async fetchProfile(accessToken: string): Promise<GitHubProfile> {
    const response = await this.request('https://api.github.com/user', {
      headers: githubHeaders(accessToken),
    })
    const body = await readJson(response)

    if (!response.ok) throw responseError(response.status)
    if (!isGitHubProfile(body)) {
      throw new GitHubOAuthError('GITHUB_RESPONSE_INVALID', false)
    }
    return body
  }

  private async fetchVerifiedPrimaryEmail(accessToken: string): Promise<string | null> {
    const response = await this.request('https://api.github.com/user/emails', {
      headers: githubHeaders(accessToken),
    })
    const body = await readJson(response)

    if (!response.ok) throw responseError(response.status)
    if (!Array.isArray(body)) throw new GitHubOAuthError('GITHUB_RESPONSE_INVALID', false)

    const primary = body.find(
      (entry): entry is GitHubEmail =>
        isRecord(entry) &&
        typeof entry.email === 'string' &&
        entry.primary === true &&
        entry.verified === true,
    )
    return primary?.email ?? null
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.httpClient(url, {
        ...init,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      if (isAbortError(error)) throw new GitHubOAuthError('GITHUB_TIMEOUT', true)
      throw new GitHubOAuthError('GITHUB_UNAVAILABLE', true)
    }
  }
}

interface GitHubProfile {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
}

interface GitHubEmail {
  email: string
  primary: true
  verified: true
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new GitHubOAuthError('GITHUB_RESPONSE_INVALID', false)
  }
}

function responseError(status: number): GitHubOAuthError {
  if (status === 400 || status === 401 || status === 403) {
    return new GitHubOAuthError('GITHUB_AUTHORIZATION_REJECTED', false)
  }
  return new GitHubOAuthError('GITHUB_UNAVAILABLE', status === 429 || status >= 500)
}

function isGitHubProfile(value: unknown): value is GitHubProfile {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    typeof value.login === 'string' &&
    value.login.length > 0 &&
    (value.name === null || typeof value.name === 'string') &&
    (value.avatar_url === null || typeof value.avatar_url === 'string')
  )
}

function normalizeGitHubAvatarUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}
