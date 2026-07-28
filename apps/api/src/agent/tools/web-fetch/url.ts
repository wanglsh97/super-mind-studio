import { AgentToolExecutionError } from '../agent-tool'

export interface NormalizedWebFetchUrl {
  /** 规范化后的绝对 URL（无 hash，保留 pathname/search）。 */
  href: string
  protocol: 'http:' | 'https:'
  hostname: string
  port: string
  /** hostname 是否为字面量 IPv4/IPv6。 */
  isIpLiteral: boolean
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.'])

/**
 * 规范化并校验 `web_fetch` 目标 URL（解析层，不含 DNS）。
 *
 * 拒绝：畸形 URL、非 http(s)、内嵌用户名/密码、localhost、环回 IP 字面量。
 * 私有网段/云元数据的 DNS 级拦截在后续任务实现。
 */
export function normalizeWebFetchUrl(raw: string): NormalizedWebFetchUrl {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed.length === 0) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_INVALID_ARGS',
      message: 'web_fetch 需要非空 url 参数',
      summary: '无效的 web_fetch 参数',
    })
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_INVALID_URL',
      message: `web_fetch 收到非法 URL：${trimmed}`,
      summary: '非法 URL',
      audit: { requestedUrl: trimmed },
    })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_UNSUPPORTED_PROTOCOL',
      message: `web_fetch 仅支持 http/https：${parsed.protocol}`,
      summary: '不支持的协议',
      audit: { requestedUrl: trimmed },
    })
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_BLOCKED_TARGET',
      message: 'web_fetch 拒绝带内嵌凭证的 URL',
      summary: '拒绝内嵌凭证',
      audit: {
        requestedUrl: redactCredentials(trimmed),
        errorCode: 'WEB_FETCH_EMBEDDED_CREDENTIALS',
      },
    })
  }

  // 去掉 hash；pathname 为空时 URL 规范为 /
  parsed.hash = ''

  const hostname = stripIpv6Brackets(parsed.hostname.toLowerCase())
  if (hostname.length === 0) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_INVALID_URL',
      message: 'web_fetch URL 缺少主机名',
      summary: '非法 URL',
      audit: { requestedUrl: trimmed },
    })
  }

  const isIpLiteral = isIpv4Literal(hostname) || isIpv6Literal(hostname)
  if (isLocalHostname(hostname) || isLoopbackIpLiteral(hostname)) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_BLOCKED_TARGET',
      message: `web_fetch 拒绝本地目标：${hostname}`,
      summary: '拒绝本地目标',
      audit: { requestedUrl: trimmed, errorCode: 'WEB_FETCH_LOCALHOST' },
    })
  }

  return {
    href: parsed.toString(),
    protocol: parsed.protocol,
    hostname,
    port: parsed.port,
    isIpLiteral,
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isLocalHostname(hostname: string): boolean {
  if (LOCAL_HOSTNAMES.has(hostname)) return true
  return hostname.endsWith('.localhost') || hostname.endsWith('.localhost.')
}

function isLoopbackIpLiteral(hostname: string): boolean {
  if (isIpv4Literal(hostname)) {
    const parts = hostname.split('.').map((part) => Number(part))
    return parts[0] === 127
  }
  if (isIpv6Literal(hostname)) {
    const expanded = expandIpv6(hostname)
    if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true
    // IPv4-mapped / IPv4-compatible loopback embedded in IPv6
    if (expanded.startsWith('0000:0000:0000:0000:0000:ffff:7f')) return true
    if (expanded.startsWith('0000:0000:0000:0000:0000:0000:7f')) return true
    return false
  }
  return false
}

export function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

/**
 * 接受 URL hostname 中的 IPv6 字面量（可带或不带方括号；`new URL` 的 hostname 不含括号）。
 */
export function isIpv6Literal(hostname: string): boolean {
  const value =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (!value.includes(':')) return false
  try {
    expandIpv6(value)
    return true
  } catch {
    return false
  }
}

/** 将 IPv6 展开为 8 组四位十六进制；非法则抛错。 */
export function expandIpv6(raw: string): string {
  let value = raw.toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1)
  }
  if (value.includes('%')) {
    throw new Error('zone id not supported')
  }
  const sides = value.split('::')
  if (sides.length > 2) throw new Error('invalid ipv6')

  const parseSide = (side: string): string[] => {
    if (side.length === 0) return []
    return side.split(':')
  }

  let head = parseSide(sides[0] ?? '')
  let tail = sides.length === 2 ? parseSide(sides[1] ?? '') : []

  // IPv4 尾部嵌入
  const last = (sides.length === 2 ? tail : head).at(-1)
  if (last && last.includes('.')) {
    const v4 = last.split('.').map((part) => Number(part))
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      throw new Error('invalid ipv4-mapped')
    }
    const mapped = [((v4[0]! << 8) | v4[1]!).toString(16), ((v4[2]! << 8) | v4[3]!).toString(16)]
    if (sides.length === 2) {
      tail = [...tail.slice(0, -1), ...mapped]
    } else {
      head = [...head.slice(0, -1), ...mapped]
    }
  }

  const missing = 8 - (head.length + (sides.length === 2 ? tail.length : 0))
  if (sides.length === 2) {
    if (missing < 0) throw new Error('invalid ipv6')
    const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail]
    return groups.map(normalizeHextet).join(':')
  }
  if (head.length !== 8) throw new Error('invalid ipv6')
  return head.map(normalizeHextet).join(':')
}

function normalizeHextet(part: string): string {
  if (!/^[0-9a-f]{1,4}$/i.test(part)) throw new Error('invalid hextet')
  return part.toLowerCase().padStart(4, '0')
}

function redactCredentials(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = '***'
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    return url
  }
}
