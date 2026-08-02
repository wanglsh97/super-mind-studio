import { z } from 'zod'

import { assertAgentMcpEnvironment, parseAgentMcpServersJson } from '../agent/mcp/agent-mcp.config'

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  return value
}, z.boolean())

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
)

const adminSessionSecret = z.preprocess(
  (value) =>
    value === undefined || value === '' ? 'development-only-admin-session-secret-change-me' : value,
  z.string().min(32),
)

const userSessionSecret = z.preprocess(
  (value) =>
    value === undefined || value === '' ? 'development-only-user-session-secret-change-me' : value,
  z.string().min(32),
)

const optionalTextModelAlias = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['qwen', 'glm', 'deepseek', 'kimi']).optional(),
)

const optionalNonNegativeDecimal = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .optional(),
)

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    OTEL_ENABLED: booleanFromEnv.default(false),
    OTEL_SERVICE_NAME: z.string().min(1).default('supermind-api'),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL 必填'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    REDIS_URL: z.string().min(1, 'REDIS_URL 必填'),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    GITHUB_OAUTH_ENABLED: booleanFromEnv.default(false),
    GITHUB_CLIENT_ID: optionalSecret,
    GITHUB_CLIENT_SECRET: optionalSecret,
    GITHUB_CALLBACK_URL: z
      .string()
      .url()
      .default('http://localhost:3001/api/v1/auth/github/callback'),
    GITHUB_OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    GOOGLE_OAUTH_ENABLED: booleanFromEnv.default(false),
    GOOGLE_CLIENT_ID: optionalSecret,
    GOOGLE_CLIENT_SECRET: optionalSecret,
    GOOGLE_CALLBACK_URL: z
      .string()
      .url()
      .default('http://localhost:3001/api/v1/auth/google/callback'),
    GOOGLE_OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    USER_SESSION_SECRET: userSessionSecret,
    USER_SESSION_TTL_SECONDS: z.coerce.number().int().default(2_592_000),
    SKILL_OBJECT_STORE_DRIVER: z.enum(['memory', 'oss']).default('memory'),
    OSS_REGION: optionalSecret,
    OSS_BUCKET: optionalSecret,
    OSS_ACCESS_KEY_ID: optionalSecret,
    OSS_ACCESS_KEY_SECRET: optionalSecret,
    OSS_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    OSS_INTERNAL: booleanFromEnv.default(false),
    OSS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    SKILL_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    SKILL_STAGING_CLEANUP_BATCH: z.coerce.number().int().min(1).max(500).default(100),
    SANDBOX_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
    OPEN_SANDBOX_DOMAIN: z.string().min(1, 'OPEN_SANDBOX_DOMAIN 必填'),
    OPEN_SANDBOX_PROTOCOL: z.enum(['http', 'https']).default('http'),
    OPEN_SANDBOX_API_KEY: z.string().min(1, 'OPEN_SANDBOX_API_KEY 必填'),
    OPEN_SANDBOX_IMAGE: z
      .string()
      .min(1)
      .default(
        'sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:v1.1.0',
      ),
    OPEN_SANDBOX_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(30),
    OPEN_SANDBOX_READY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(60),
    OPEN_SANDBOX_USE_SERVER_PROXY: booleanFromEnv.default(true),
    AGENT_WEB_SEARCH_ENABLED: booleanFromEnv.default(true),
    AGENT_WEB_SEARCH_PROVIDER: z.enum(['auto', 'exa', 'parallel']).default('auto'),
    AGENT_WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
    AGENT_WEB_SEARCH_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(4_194_304)
      .default(2_097_152),
    AGENT_WEB_SEARCH_MAX_OUTPUT_CHARS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(50_000)
      .default(30_000),
    AGENT_MCP_SERVERS_JSON: z.preprocess((value, context) => {
      try {
        return parseAgentMcpServersJson(value)
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'MCP Server 配置无效',
        })
        return z.NEVER
      }
    }, z.array(z.unknown()).default([])),
    AGENT_MCP_DISCOVERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    AGENT_MCP_CALL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    AGENT_MCP_MAX_TOOLS_PER_SERVER: z.coerce.number().int().min(1).max(100).default(50),
    AGENT_MCP_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(4_194_304)
      .default(1_048_576),
    AGENT_MCP_MAX_OUTPUT_CHARS: z.coerce.number().int().min(1_000).max(50_000).default(20_000),
    AGENT_MAX_CONCURRENT_RUNS_PER_USER: z.coerce.number().int().min(1).max(5).default(3),
    EXA_API_KEY: optionalSecret,
    PARALLEL_API_KEY: optionalSecret,
    AMAP_MCP_API_KEY: optionalSecret,
    VARIFLIGHT_MCP_API_KEY: optionalSecret,
    MOCK_PROVIDER_ENABLED: booleanFromEnv.default(true),
    QWEN_ENABLED: booleanFromEnv.default(false),
    GLM_ENABLED: booleanFromEnv.default(false),
    DEEPSEEK_ENABLED: booleanFromEnv.default(false),
    KIMI_ENABLED: booleanFromEnv.default(false),
    QWEN_API_KEY: optionalSecret,
    QWEN_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    GLM_API_KEY: optionalSecret,
    GLM_BASE_URL: z.string().url().default('https://open.bigmodel.cn/api/paas/v4'),
    DEEPSEEK_API_KEY: optionalSecret,
    DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
    KIMI_API_KEY: optionalSecret,
    KIMI_BASE_URL: z.string().url().default('https://api.moonshot.cn/v1'),
    QWEN_FALLBACK_ALIAS: optionalTextModelAlias,
    GLM_FALLBACK_ALIAS: optionalTextModelAlias,
    DEEPSEEK_FALLBACK_ALIAS: optionalTextModelAlias,
    KIMI_FALLBACK_ALIAS: optionalTextModelAlias,
    PROMPT_OPTIMIZER_MODEL: z.enum(['qwen', 'glm', 'deepseek']).default('qwen'),
    CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    IMAGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
    IMAGE_DOWNLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(50_000_000)
      .default(10_000_000),
    ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
    ADMIN_FIXED_CREDENTIALS_ENABLED: booleanFromEnv.default(true),
    ADMIN_SESSION_SECRET: adminSessionSecret,
    ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    CHAT_MAX_TOKENS: z.coerce.number().int().min(1).max(4096).default(4096),
    PROVIDER_HEALTH_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    PROVIDER_HEALTH_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(10).default(3),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
    PROVIDER_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(200).default(20),
    PRICING_VERSION: z.string().min(1).default('dev-v1'),
    QWEN_INPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    QWEN_OUTPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    GLM_INPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    GLM_OUTPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    DEEPSEEK_INPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    DEEPSEEK_OUTPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    KIMI_INPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
    KIMI_OUTPUT_PRICE_CNY_PER_MILLION: optionalNonNegativeDecimal,
  })
  .passthrough()
  .superRefine((env, context) => {
    if (env.USER_SESSION_TTL_SECONDS !== 2_592_000) {
      context.addIssue({
        code: 'custom',
        path: ['USER_SESSION_TTL_SECONDS'],
        message: '用户 Session 必须使用固定 30 天有效期（2592000 秒）',
      })
    }
    if (env.SKILL_OBJECT_STORE_DRIVER === 'oss') {
      for (const key of [
        'OSS_REGION',
        'OSS_BUCKET',
        'OSS_ACCESS_KEY_ID',
        'OSS_ACCESS_KEY_SECRET',
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `使用 OSS 对象存储时必须配置 ${key}`,
          })
        }
      }
    }
    if (env.GITHUB_OAUTH_ENABLED) {
      if (!env.GITHUB_CLIENT_ID) {
        context.addIssue({
          code: 'custom',
          path: ['GITHUB_CLIENT_ID'],
          message: '启用 GitHub OAuth 时必须配置 Client ID',
        })
      }
      if (!env.GITHUB_CLIENT_SECRET) {
        context.addIssue({
          code: 'custom',
          path: ['GITHUB_CLIENT_SECRET'],
          message: '启用 GitHub OAuth 时必须配置 Client Secret',
        })
      }
    }
    if (env.GOOGLE_OAUTH_ENABLED) {
      if (!env.GOOGLE_CLIENT_ID) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CLIENT_ID'],
          message: '启用 Google OAuth 时必须配置 Client ID',
        })
      }
      if (!env.GOOGLE_CLIENT_SECRET) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CLIENT_SECRET'],
          message: '启用 Google OAuth 时必须配置 Client Secret',
        })
      }
    }
    if (
      env.NODE_ENV === 'production' &&
      env.USER_SESSION_SECRET === 'development-only-user-session-secret-change-me'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['USER_SESSION_SECRET'],
        message: '生产环境必须配置独立的用户会话密钥',
      })
    }
    if (
      env.NODE_ENV === 'production' &&
      env.GITHUB_OAUTH_ENABLED &&
      !env.GITHUB_CALLBACK_URL.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GITHUB_CALLBACK_URL'],
        message: '生产环境 GitHub callback 必须使用 HTTPS',
      })
    }
    if (
      env.NODE_ENV === 'production' &&
      env.GOOGLE_OAUTH_ENABLED &&
      !env.GOOGLE_CALLBACK_URL.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CALLBACK_URL'],
        message: '生产环境 Google callback 必须使用 HTTPS',
      })
    }
    if (
      env.NODE_ENV === 'production' &&
      env.ADMIN_SESSION_SECRET === 'development-only-admin-session-secret-change-me'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_SESSION_SECRET'],
        message: '生产环境必须配置独立的管理员会话密钥',
      })
    }
    const providers = [
      { name: 'QWEN', enabled: env.QWEN_ENABLED, key: env.QWEN_API_KEY },
      { name: 'GLM', enabled: env.GLM_ENABLED, key: env.GLM_API_KEY },
      {
        name: 'DEEPSEEK',
        enabled: env.DEEPSEEK_ENABLED,
        key: env.DEEPSEEK_API_KEY,
      },
      { name: 'KIMI', enabled: env.KIMI_ENABLED, key: env.KIMI_API_KEY },
    ]

    for (const provider of providers) {
      if (!provider.enabled) continue
      if (!provider.key) {
        context.addIssue({
          code: 'custom',
          path: [`${provider.name}_API_KEY`],
          message: `${provider.name} 启用时必须配置 API Key`,
        })
      }
    }

    const fallbacks = [
      { alias: 'qwen', fallback: env.QWEN_FALLBACK_ALIAS },
      { alias: 'glm', fallback: env.GLM_FALLBACK_ALIAS },
      { alias: 'deepseek', fallback: env.DEEPSEEK_FALLBACK_ALIAS },
      { alias: 'kimi', fallback: env.KIMI_FALLBACK_ALIAS },
    ]
    for (const { alias, fallback } of fallbacks) {
      if (fallback === alias) {
        context.addIssue({
          code: 'custom',
          path: [`${alias.toUpperCase()}_FALLBACK_ALIAS`],
          message: 'fallback alias 不能与主模型 alias 相同',
        })
      }
    }
  })

export type Environment = z.infer<typeof environmentSchema>

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input)

  if (result.success) {
    try {
      assertAgentMcpEnvironment(
        result.data.AGENT_MCP_SERVERS_JSON as ReturnType<typeof parseAgentMcpServersJson>,
        { ...process.env, ...input },
        result.data.NODE_ENV,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP Server 配置无效'
      throw new Error(`环境变量校验失败：AGENT_MCP_SERVERS_JSON: ${message}`)
    }
    return result.data
  }

  const reasons = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ')
  throw new Error(`环境变量校验失败：${reasons}`)
}
