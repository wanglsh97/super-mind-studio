import { classifyIpAddress, isPublicIpAddress } from './address'

describe('classifyIpAddress', () => {
  it('accepts public addresses', () => {
    expect(classifyIpAddress('8.8.8.8')).toBe('public')
    expect(classifyIpAddress('1.1.1.1')).toBe('public')
    expect(classifyIpAddress('2001:4860:4860::8888')).toBe('public')
    expect(isPublicIpAddress('93.184.216.34')).toBe(true)
  })

  it('rejects loopback, private, link-local, multicast, reserved and metadata', () => {
    expect(classifyIpAddress('127.0.0.1')).toBe('loopback')
    expect(classifyIpAddress('10.0.0.5')).toBe('private')
    expect(classifyIpAddress('192.168.1.1')).toBe('private')
    expect(classifyIpAddress('172.16.5.5')).toBe('private')
    expect(classifyIpAddress('169.254.10.10')).toBe('link_local')
    expect(classifyIpAddress('169.254.169.254')).toBe('cloud_metadata')
    expect(classifyIpAddress('224.0.0.1')).toBe('multicast')
    expect(classifyIpAddress('0.0.0.0')).toBe('unspecified')
    expect(classifyIpAddress('::1')).toBe('loopback')
    expect(classifyIpAddress('fc00::1')).toBe('private')
    expect(classifyIpAddress('fe80::1')).toBe('link_local')
    expect(classifyIpAddress('::ffff:127.0.0.1')).toBe('loopback')
    expect(classifyIpAddress('::ffff:10.0.0.1')).toBe('private')
  })
})
