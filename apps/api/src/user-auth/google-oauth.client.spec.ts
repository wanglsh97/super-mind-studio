import { GoogleOAuthClient, GoogleOAuthError, type GoogleHttpClient } from './google-oauth.client'

const options = {
  clientId: 'fixture-google-client-id',
  clientSecret: 'fixture-google-client-secret',
  callbackUrl: 'http://localhost:3001/api/v1/auth/google/callback',
  timeoutMs: 1_000,
}

describe('GoogleOAuthClient', () => {
  it('maps a verified OIDC profile to a generic identity', async () => {
    const http = sequenceHttp([
      jsonResponse({ access_token: 'temporary-google-token' }),
      jsonResponse({
        sub: 'google-subject-1',
        name: 'Example User',
        picture: 'https://lh3.googleusercontent.com/a/example',
        email: 'user@example.test',
        email_verified: true,
      }),
    ])

    await expect(
      new GoogleOAuthClient(options, http).authenticate('fixture-code'),
    ).resolves.toEqual({
      authProvider: 'GOOGLE',
      providerUserId: 'google-subject-1',
      userName: 'Example User',
      avatarUrl: 'https://lh3.googleusercontent.com/a/example',
      email: 'user@example.test',
    })
    expect(http).toHaveBeenNthCalledWith(
      1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        body: expect.stringContaining('code=fixture-code'),
      }),
    )
  })

  it.each([
    [
      { sub: 'subject', name: '', email: 'hidden@example.test', email_verified: false },
      'Google User',
    ],
    [
      { sub: 'subject', email: 'verified@example.test', email_verified: true },
      'verified@example.test',
    ],
    [{ sub: 'subject' }, 'Google User'],
  ])('allows missing or unverified email for profile %p', async (profile, expectedName) => {
    const http = sequenceHttp([jsonResponse({ access_token: 'token' }), jsonResponse(profile)])

    await expect(new GoogleOAuthClient(options, http).authenticate('code')).resolves.toMatchObject({
      providerUserId: 'subject',
      userName: expectedName,
      email: 'email_verified' in profile && profile.email_verified === true ? profile.email : null,
    })
  })

  it('rejects a profile without a stable sub', async () => {
    const http = sequenceHttp([
      jsonResponse({ access_token: 'token' }),
      jsonResponse({ name: 'No Subject' }),
    ])

    await expect(new GoogleOAuthClient(options, http).authenticate('code')).rejects.toMatchObject({
      code: 'GOOGLE_RESPONSE_INVALID',
      retryable: false,
    } satisfies Partial<GoogleOAuthError>)
  })

  it('normalizes timeouts', async () => {
    const http = jest
      .fn<ReturnType<GoogleHttpClient>, Parameters<GoogleHttpClient>>()
      .mockRejectedValue(new DOMException('fixture secret', 'TimeoutError'))

    await expect(new GoogleOAuthClient(options, http).authenticate('code')).rejects.toMatchObject({
      code: 'GOOGLE_TIMEOUT',
      retryable: true,
    })
  })
})

function sequenceHttp(responses: Response[]): jest.MockedFunction<GoogleHttpClient> {
  return jest
    .fn<ReturnType<GoogleHttpClient>, Parameters<GoogleHttpClient>>()
    .mockImplementation(async () => {
      const response = responses.shift()
      if (!response) throw new Error('Unexpected HTTP request')
      return response
    }) as jest.MockedFunction<GoogleHttpClient>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
