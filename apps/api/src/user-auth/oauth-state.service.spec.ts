import { OAuthStateError, OAuthStateService, sanitizeReturnTo } from './oauth-state.service'

describe('OAuthStateService', () => {
  const service = new OAuthStateService('fixture-state-secret-with-at-least-32-characters')

  it('round-trips a safe return path', () => {
    const created = service.create('GITHUB', '/', 1_000)

    expect(service.verify('GITHUB', created.state, created.cookieValue, 2_000)).toBe('/')
  })

  it.each([
    'https://attacker.example/path',
    '//attacker.example/path',
    '/admin',
    '/agent',
    '/chat',
    '/chat?next=https://attacker.example',
    '/image',
    '/prompt',
    'javascript:alert(1)',
  ])('replaces unsafe return target %s', (value) => {
    expect(sanitizeReturnTo(value)).toBe('/')
  })

  it('rejects a state mismatch with a normalized error', () => {
    const created = service.create('GITHUB', '/', 1_000)

    expect(() => service.verify('GITHUB', 'forged-state', created.cookieValue, 2_000)).toThrow(
      expect.objectContaining({ code: 'OAUTH_STATE_INVALID' }) as OAuthStateError,
    )
  })

  it('rejects a tampered state cookie', () => {
    const created = service.create('GITHUB', '/', 1_000)

    expect(() => service.verify('GITHUB', created.state, `${created.cookieValue}x`, 2_000)).toThrow(
      'OAuth 登录请求已失效',
    )
  })

  it('rejects an expired state', () => {
    const serviceWithShortTtl = new OAuthStateService(
      'fixture-state-secret-with-at-least-32-characters',
      100,
    )
    const created = serviceWithShortTtl.create('GITHUB', '/', 1_000)

    expect(() =>
      serviceWithShortTtl.verify('GITHUB', created.state, created.cookieValue, 1_100),
    ).toThrow(expect.objectContaining({ code: 'OAUTH_STATE_EXPIRED' }) as OAuthStateError)
  })

  it('rejects state created for another OAuth provider', () => {
    const created = service.create('GITHUB', '/', 1_000)

    expect(() => service.verify('GOOGLE', created.state, created.cookieValue, 2_000)).toThrow(
      expect.objectContaining({ code: 'OAUTH_STATE_INVALID' }) as OAuthStateError,
    )
  })
})
