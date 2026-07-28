import { isIPv4, isIPv6 } from 'node:net'

import { expandIpv6, isIpv4Literal } from './url'

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'multicast'
  | 'reserved'
  | 'unspecified'
  | 'cloud_metadata'

const CLOUD_METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '169.254.169.253'])

/**
 * 对单个 IP 字面量做 fail-closed 分类。无法识别或特殊用途一律非 public。
 */
export function classifyIpAddress(address: string): AddressClass {
  const normalized = normalizeAddress(address)
  if (!normalized) return 'reserved'

  if (normalized.family === 4) {
    return classifyIpv4(normalized.ip)
  }
  return classifyIpv6(normalized.ip)
}

export function assertPublicIpAddress(address: string): void {
  const kind = classifyIpAddress(address)
  if (kind !== 'public') {
    throw Object.assign(new Error(`blocked address class: ${kind}`), {
      code: 'WEB_FETCH_BLOCKED_TARGET',
      addressClass: kind,
      address,
    })
  }
}

export function isPublicIpAddress(address: string): boolean {
  return classifyIpAddress(address) === 'public'
}

function classifyIpv4(ip: string): AddressClass {
  if (CLOUD_METADATA_V4.has(ip)) return 'cloud_metadata'
  if (ip === '0.0.0.0') return 'unspecified'
  if (ip.startsWith('127.')) return 'loopback'
  if (ip.startsWith('169.254.')) return 'link_local'
  if (isMulticastV4(ip)) return 'multicast'
  if (isPrivateV4(ip)) return 'private'
  if (isReservedV4(ip)) return 'reserved'
  return 'public'
}

function classifyIpv6(ip: string): AddressClass {
  const expanded = expandIpv6(ip)
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return 'unspecified'
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return 'loopback'
  if (expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const parts = expanded.split(':')
    const high = Number.parseInt(parts[6] ?? '0', 16)
    const low = Number.parseInt(parts[7] ?? '0', 16)
    const v4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
    return classifyIpv4(v4)
  }
  if (expanded.startsWith('fe80:')) return 'link_local'
  if (expanded.startsWith('ff')) return 'multicast'
  if (expanded.startsWith('fc') || expanded.startsWith('fd')) {
    // fd00:ec2::254 AWS IMDS
    if (expanded === expandIpv6('fd00:ec2::254')) return 'cloud_metadata'
    return 'private'
  }
  if (expanded.startsWith('2001:0db8:')) return 'reserved'
  return 'public'
}

function normalizeAddress(address: string): { family: 4 | 6; ip: string } | null {
  const trimmed = address.trim().toLowerCase()
  const bare = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  if (isIPv4(bare) || isIpv4Literal(bare)) return { family: 4, ip: bare }
  if (isIPv6(bare)) return { family: 6, ip: bare }
  return null
}

function isPrivateV4(ip: string): boolean {
  const octets = ip.split('.').map((part) => Number(part))
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isMulticastV4(ip: string): boolean {
  const a = Number(ip.split('.')[0])
  return a >= 224 && a <= 239
}

function isReservedV4(ip: string): boolean {
  const octets = ip.split('.').map((part) => Number(part))
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  const c = octets[2] ?? -1
  if (a === 0) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 192 && b === 0 && c === 2) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 240) return true
  if (ip === '255.255.255.255') return true
  return false
}
