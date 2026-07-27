import { z } from 'zod'

const serverId = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, '必须是小写字母、数字或连字符')
const remoteToolName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, '只能包含字母、数字、下划线或连字符')
const tokenEnvironmentName = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, '必须是大写环境变量名')

const configuredToolSchema = z.object({
  name: remoteToolName,
  description: z.string().trim().min(1).max(300).optional(),
  riskLevel: z.enum(['read', 'external_send']).default('read'),
})

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), tokenEnv: tokenEnvironmentName }),
])

const configuredServerSchema = z
  .object({
    id: serverId,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(''),
    url: z.string().url(),
    auth: authSchema.default({ type: 'none' }),
    tools: z.array(configuredToolSchema).min(1).max(50),
  })
  .superRefine((server, context) => {
    const seen = new Set<string>()
    for (const [index, tool] of server.tools.entries()) {
      if (seen.has(tool.name)) {
        context.addIssue({
          code: 'custom',
          path: ['tools', index, 'name'],
          message: '同一 MCP Server 的工具名不能重复',
        })
      }
      seen.add(tool.name)
    }
  })

const configuredServersSchema = z
  .array(configuredServerSchema)
  .max(10)
  .superRefine((servers, context) => {
    const seen = new Set<string>()
    for (const [index, server] of servers.entries()) {
      if (seen.has(server.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'MCP Server ID 不能重复',
        })
      }
      seen.add(server.id)
    }
  })

export type AgentMcpServerConfig = z.infer<typeof configuredServerSchema>

export function parseAgentMcpServersJson(value: unknown): AgentMcpServerConfig[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return configuredServersSchema.parse(value)
  if (typeof value !== 'string') {
    throw new Error('必须是 JSON 数组')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('必须是有效 JSON')
  }
  return configuredServersSchema.parse(parsed)
}

export function assertAgentMcpEnvironment(
  servers: readonly AgentMcpServerConfig[],
  input: Readonly<Record<string, unknown>>,
  nodeEnvironment: 'development' | 'test' | 'production',
): void {
  for (const server of servers) {
    const url = new URL(server.url)
    if (nodeEnvironment === 'production' && url.protocol !== 'https:') {
      throw new Error(`MCP Server ${server.id} 在生产环境必须使用 HTTPS`)
    }
    if (
      nodeEnvironment !== 'production' &&
      url.protocol === 'http:' &&
      !isLoopbackHostname(url.hostname)
    ) {
      throw new Error(`MCP Server ${server.id} 的本地 HTTP 地址必须是 loopback`)
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`MCP Server ${server.id} 只支持 HTTP(S)`)
    }
    if (server.auth.type === 'bearer') {
      const token = input[server.auth.tokenEnv]
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error(`MCP Server ${server.id} 缺少 Bearer Token 环境变量`)
      }
    }
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]'
}
