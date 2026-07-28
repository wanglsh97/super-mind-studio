import assert from 'node:assert/strict'

import { AgentToolExecutionError } from '../agent-tool'
import { expandIpv6, isIpv4Literal, isIpv6Literal, normalizeWebFetchUrl } from './url'

describe('normalizeWebFetchUrl', () => {
  it('normalizes http(s) URLs and strips hash', () => {
    const result = normalizeWebFetchUrl(' https://Example.COM/path?q=1#frag ')
    expect(result).toMatchObject({
      protocol: 'https:',
      hostname: 'example.com',
      isIpLiteral: false,
    })
    expect(result.href).toBe('https://example.com/path?q=1')
    expect(result.href.includes('#')).toBe(false)
  })

  it('rejects malformed, empty, and non-http protocols', () => {
    expect(() => normalizeWebFetchUrl('')).toThrow(AgentToolExecutionError)
    expect(() => normalizeWebFetchUrl('not a url')).toThrow(
      expect.objectContaining({ code: 'WEB_FETCH_INVALID_URL' }),
    )
    expect(() => normalizeWebFetchUrl('ftp://example.com')).toThrow(
      expect.objectContaining({ code: 'WEB_FETCH_UNSUPPORTED_PROTOCOL' }),
    )
    expect(() => normalizeWebFetchUrl('file:///etc/passwd')).toThrow(
      expect.objectContaining({ code: 'WEB_FETCH_UNSUPPORTED_PROTOCOL' }),
    )
  })

  it('rejects embedded credentials without leaking secrets in the message', () => {
    try {
      normalizeWebFetchUrl('https://user:secret@example.com/a')
      assert.fail('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolExecutionError)
      const err = error as AgentToolExecutionError
      expect(err.code).toBe('WEB_FETCH_BLOCKED_TARGET')
      expect(err.message).not.toContain('secret')
      expect(String(err.audit?.requestedUrl ?? '')).not.toContain('secret')
    }
  })

  it('rejects localhost hostnames', () => {
    for (const url of [
      'http://localhost/',
      'https://localhost:8080/x',
      'http://foo.localhost/bar',
      'http://LocalHost./',
    ]) {
      expect(() => normalizeWebFetchUrl(url)).toThrow(
        expect.objectContaining({ code: 'WEB_FETCH_BLOCKED_TARGET' }),
      )
    }
  })

  it('rejects IPv4 and IPv6 loopback literals', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1.2.3/a',
      'http://[::1]/',
      'http://[0:0:0:0:0:0:0:1]/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(() => normalizeWebFetchUrl(url)).toThrow(
        expect.objectContaining({ code: 'WEB_FETCH_BLOCKED_TARGET' }),
      )
    }
  })

  it('accepts public IPv4/IPv6 literals at the URL layer (DNS classification is later)', () => {
    expect(normalizeWebFetchUrl('http://8.8.8.8/').isIpLiteral).toBe(true)
    expect(normalizeWebFetchUrl('http://[2001:4860:4860::8888]/').hostname).toBe(
      '2001:4860:4860::8888',
    )
    expect(isIpv4Literal('203.0.113.10')).toBe(true)
    expect(isIpv4Literal('203.0.113.256')).toBe(false)
    expect(isIpv6Literal('2001:db8::1')).toBe(true)
    expect(expandIpv6('::1')).toBe('0000:0000:0000:0000:0000:0000:0000:0001')
    expect(expandIpv6('::ffff:127.0.0.1')).toBe('0000:0000:0000:0000:0000:ffff:7f00:0001')
  })
})
