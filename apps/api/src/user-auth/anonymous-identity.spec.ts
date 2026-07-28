import { createAnonymousIdentity } from './anonymous-identity'

describe('anonymous identity', () => {
  it('creates a new provider-neutral identity on every call', () => {
    const first = createAnonymousIdentity()
    const second = createAnonymousIdentity()

    expect(first).toMatchObject({
      authProvider: 'ANONYMOUS',
      userName: 'Anonymous User',
      email: null,
      avatarUrl: null,
    })
    expect(first.providerUserId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.providerUserId).not.toBe(first.providerUserId)
    expect(first.email).toBeNull()
    expect(first.avatarUrl).toBeNull()
  })
})
