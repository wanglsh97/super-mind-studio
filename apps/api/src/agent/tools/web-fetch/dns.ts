import { Resolver } from 'node:dns/promises'

import { AgentToolExecutionError } from '../agent-tool'
import { assertPublicIpAddress, classifyIpAddress, type AddressClass } from './address'

export interface ResolvedHostAddresses {
  hostname: string
  addresses: string[]
}

export type HostResolver = (hostname: string) => Promise<string[]>

const defaultResolver = new Resolver()

/**
 * 解析 hostname 的全部 A/AAAA 地址，并对每一个做公网分类；任一非 public 或解析为空则 fail-closed。
 */
export async function resolveAndValidateHost(
  hostname: string,
  resolve: HostResolver = resolveAllAddresses,
): Promise<ResolvedHostAddresses> {
  let addresses: string[]
  try {
    addresses = await resolve(hostname)
  } catch (error) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_BLOCKED_TARGET',
      message: `web_fetch 无法解析主机：${hostname}`,
      summary: 'DNS 解析失败',
      audit: {
        requestedHost: hostname,
        errorCode: 'WEB_FETCH_DNS_FAILED',
        detail: error instanceof Error ? error.message : 'dns error',
      },
    })
  }

  const unique = [...new Set(addresses.map((item) => item.trim()).filter(Boolean))]
  if (unique.length === 0) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_BLOCKED_TARGET',
      message: `web_fetch 主机无可用地址：${hostname}`,
      summary: 'DNS 无结果',
      audit: { requestedHost: hostname, errorCode: 'WEB_FETCH_DNS_EMPTY' },
    })
  }

  const classes: Array<{ address: string; addressClass: AddressClass }> = []
  for (const address of unique) {
    const addressClass = classifyIpAddress(address)
    classes.push({ address, addressClass })
    if (addressClass !== 'public') {
      throw new AgentToolExecutionError({
        code: 'WEB_FETCH_BLOCKED_TARGET',
        message: `web_fetch 拒绝非公网目标 ${hostname} → ${address} (${addressClass})`,
        summary: '拒绝非公网目标',
        audit: {
          requestedHost: hostname,
          address,
          addressClass,
          errorCode: 'WEB_FETCH_BLOCKED_ADDRESS',
        },
      })
    }
    assertPublicIpAddress(address)
  }

  return { hostname, addresses: unique }
}

export async function resolveAllAddresses(hostname: string): Promise<string[]> {
  // lookup 不走系统缓存旁路；并行 A + AAAA，任一成功即可，但必须校验全部返回地址。
  const results = await Promise.allSettled([
    defaultResolver.resolve4(hostname),
    defaultResolver.resolve6(hostname),
  ])
  const addresses: string[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') addresses.push(...result.value)
  }
  if (addresses.length === 0) {
    const errors = results
      .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      .map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason)))
    throw new Error(errors.join('; ') || 'ENOTFOUND')
  }
  return addresses
}

/**
 * 连接固定：只允许使用解析阶段已校验过的地址集合，防止 DNS rebinding。
 */
export function pickPinnedAddress(
  resolved: ResolvedHostAddresses,
  preferFamily: 4 | 6 = 4,
): string {
  const ordered =
    preferFamily === 4
      ? [...resolved.addresses.filter((ip) => ip.includes('.')), ...resolved.addresses]
      : [...resolved.addresses.filter((ip) => ip.includes(':')), ...resolved.addresses]
  const pinned = ordered[0]
  if (!pinned) {
    throw new AgentToolExecutionError({
      code: 'WEB_FETCH_BLOCKED_TARGET',
      message: `web_fetch 无可用固定地址：${resolved.hostname}`,
      summary: '无可用地址',
    })
  }
  assertPublicIpAddress(pinned)
  return pinned
}
