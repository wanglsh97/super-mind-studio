import { GitHubOAuthClient, GitHubOAuthError, type GitHubHttpClient } from './github-oauth.client'

const options = {
  clientId: 'fixture-client-id',
  clientSecret: 'fixture-client-secret',
  callbackUrl: 'http://localhost:3001/api/v1/auth/github/callback',
  timeoutMs: 1_000,
}

describe('GitHubOAuthClient', () => {
  it('maps profile and verified primary email without exposing provider token', async () => {
    const http = sequenceHttp([
      jsonResponse({ access_token: 'temporary-token' }),
      jsonResponse({
        id: 12345678,
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/12345678?v=4',
      }),
      jsonResponse([
        { email: 'secondary@example.com', primary: false, verified: true },
        { email: 'octocat@github.example', primary: true, verified: true },
      ]),
    ])

    await expect(
      new GitHubOAuthClient(options, http).authenticate('fixture-code'),
    ).resolves.toEqual({
      authProvider: 'GITHUB',
      providerUserId: '12345678',
      userName: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345678?v=4',
      email: 'octocat@github.example',
    })

    expect(http).toHaveBeenNthCalledWith(
      1,
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({
        body: expect.stringContaining('fixture-code'),
      }),
    )
    expect(JSON.stringify(await new GitHubOAuthClient(options, http))).not.toContain(
      'temporary-token',
    )
  })

  it('allows a profile without a verified primary email', async () => {
    const http = sequenceHttp([
      jsonResponse({ access_token: 'temporary-token' }),
      jsonResponse({ id: 1, login: 'no-email', name: null, avatar_url: null }),
      jsonResponse([{ email: 'hidden@example.com', primary: true, verified: false }]),
    ])

    await expect(new GitHubOAuthClient(options, http).authenticate('code')).resolves.toMatchObject({
      authProvider: 'GITHUB',
      providerUserId: '1',
      email: null,
    })
  })

  it('normalizes invalid provider payloads', async () => {
    const http = sequenceHttp([jsonResponse({ unexpected: true })])

    await expect(new GitHubOAuthClient(options, http).authenticate('code')).rejects.toMatchObject({
      code: 'GITHUB_RESPONSE_INVALID',
      retryable: false,
    } satisfies Partial<GitHubOAuthError>)
  })

  it('normalizes timeouts without returning the underlying error', async () => {
    const http = jest
      .fn<ReturnType<GitHubHttpClient>, Parameters<GitHubHttpClient>>()
      .mockRejectedValue(new DOMException('fixture secret', 'TimeoutError'))

    await expect(new GitHubOAuthClient(options, http).authenticate('code')).rejects.toEqual(
      expect.objectContaining({ code: 'GITHUB_TIMEOUT', retryable: true }),
    )
  })
})

function sequenceHttp(responses: Response[]): jest.MockedFunction<GitHubHttpClient> {
  return jest
    .fn<ReturnType<GitHubHttpClient>, Parameters<GitHubHttpClient>>()
    .mockImplementation(async () => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected HTTP request')
      return response
    }) as jest.MockedFunction<GitHubHttpClient>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
