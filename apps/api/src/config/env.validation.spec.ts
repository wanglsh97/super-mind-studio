import { validateEnvironment } from './env.validation'

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://aigateway:password@localhost:5432/aigateway',
  REDIS_URL: 'redis://localhost:6379',
  OPEN_SANDBOX_DOMAIN: '172.16.1.20:8080',
  OPEN_SANDBOX_API_KEY: 'sandbox-test-key',
}

describe('validateEnvironment', () => {
  it('applies safe defaults for a Mock-only environment', () => {
    const environment = validateEnvironment(requiredEnvironment)

    expect(environment.MOCK_PROVIDER_ENABLED).toBe(true)
    expect(environment.QWEN_ENABLED).toBe(false)
    expect(environment.QWEN_BASE_URL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(environment.GLM_BASE_URL).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(environment.DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com')
    expect(environment.KIMI_ENABLED).toBe(false)
    expect(environment.KIMI_BASE_URL).toBe('https://api.moonshot.cn/v1')
    expect(environment.API_PORT).toBe(3001)
    expect(environment.TRUSTED_PROXY_HOPS).toBe(1)
    expect(environment.GITHUB_OAUTH_ENABLED).toBe(false)
    expect(environment.GITHUB_CALLBACK_URL).toBe(
      'http://localhost:3001/api/v1/auth/github/callback',
    )
    expect(environment.GITHUB_OAUTH_HTTP_TIMEOUT_MS).toBe(10_000)
    expect(environment.GOOGLE_OAUTH_ENABLED).toBe(false)
    expect(environment.GOOGLE_CALLBACK_URL).toBe(
      'http://localhost:3001/api/v1/auth/google/callback',
    )
    expect(environment.GOOGLE_OAUTH_HTTP_TIMEOUT_MS).toBe(10_000)
    expect(environment.USER_SESSION_TTL_SECONDS).toBe(2_592_000)
    expect(environment.CHAT_RATE_LIMIT_PER_MINUTE).toBe(10)
    expect(environment.CHAT_MAX_TOKENS).toBe(4096)
    expect(environment.PROVIDER_TIMEOUT_MS).toBe(60_000)
    expect(environment.PROVIDER_MAX_CONNECTIONS).toBe(20)
    expect(environment.ADMIN_SESSION_TTL_SECONDS).toBe(900)
    expect(environment.ADMIN_FIXED_CREDENTIALS_ENABLED).toBe(true)
    expect(environment.SKILL_OBJECT_STORE_DRIVER).toBe('memory')
    expect(environment.OSS_INTERNAL).toBe(false)
    expect(environment.OSS_TIMEOUT_MS).toBe(30_000)
    expect(environment.SKILL_UPLOAD_TTL_SECONDS).toBe(300)
    expect(environment.SKILL_STAGING_CLEANUP_BATCH).toBe(100)
    expect(environment.SANDBOX_TIMEOUT_SECONDS).toBe(3_600)
    expect(environment.OPEN_SANDBOX_PROTOCOL).toBe('http')
    expect(environment.OPEN_SANDBOX_REQUEST_TIMEOUT_SECONDS).toBe(30)
    expect(environment.OPEN_SANDBOX_READY_TIMEOUT_SECONDS).toBe(60)
    expect(environment.OPEN_SANDBOX_USE_SERVER_PROXY).toBe(true)
    expect(environment.AGENT_WEB_SEARCH_ENABLED).toBe(true)
    expect(environment.AGENT_WEB_SEARCH_PROVIDER).toBe('auto')
    expect(environment.AGENT_WEB_SEARCH_TIMEOUT_MS).toBe(25_000)
    expect(environment.AGENT_WEB_SEARCH_MAX_RESPONSE_BYTES).toBe(2_097_152)
    expect(environment.AGENT_WEB_SEARCH_MAX_OUTPUT_CHARS).toBe(30_000)
    expect(environment.EXA_API_KEY).toBeUndefined()
    expect(environment.PARALLEL_API_KEY).toBeUndefined()
    expect(environment.AMAP_MCP_API_KEY).toBeUndefined()
    expect(environment.VARIFLIGHT_MCP_API_KEY).toBeUndefined()
    expect(environment.AGENT_MCP_SERVERS_JSON).toEqual([])
    expect(environment.AGENT_MCP_DISCOVERY_TIMEOUT_MS).toBe(10_000)
    expect(environment.AGENT_MCP_CALL_TIMEOUT_MS).toBe(30_000)
    expect(environment.AGENT_MCP_MAX_TOOLS_PER_SERVER).toBe(50)
    expect(environment.AGENT_MCP_MAX_RESPONSE_BYTES).toBe(1_048_576)
    expect(environment.AGENT_MCP_MAX_OUTPUT_CHARS).toBe(20_000)
    expect(environment.AGENT_MAX_CONCURRENT_RUNS_PER_USER).toBe(5)
  })

  it('accepts a fixed anonymous web-search provider without API keys', () => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_WEB_SEARCH_PROVIDER: 'parallel',
        EXA_API_KEY: '',
        PARALLEL_API_KEY: '',
      }),
    ).toMatchObject({
      AGENT_WEB_SEARCH_ENABLED: true,
      AGENT_WEB_SEARCH_PROVIDER: 'parallel',
      EXA_API_KEY: undefined,
      PARALLEL_API_KEY: undefined,
    })
  })

  it('rejects unsafe web-search resource limits', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_WEB_SEARCH_TIMEOUT_MS: '999',
        AGENT_WEB_SEARCH_MAX_RESPONSE_BYTES: '512',
        AGENT_WEB_SEARCH_MAX_OUTPUT_CHARS: '999',
      }),
    ).toThrow('环境变量校验失败')
  })

  it('accepts only bounded per-user Agent concurrency', () => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_MAX_CONCURRENT_RUNS_PER_USER: '5',
      }).AGENT_MAX_CONCURRENT_RUNS_PER_USER,
    ).toBe(5)
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_MAX_CONCURRENT_RUNS_PER_USER: '6',
      }),
    ).toThrow('环境变量校验失败')
  })

  it('accepts a loopback MCP Server with an explicit read-only tool allowlist', () => {
    const environment = validateEnvironment({
      ...requiredEnvironment,
      AGENT_MCP_SERVERS_JSON: JSON.stringify([
        {
          id: 'local-docs',
          name: 'Local docs',
          url: 'http://127.0.0.1:4100/mcp',
          tools: [{ name: 'lookup', riskLevel: 'read' }],
        },
      ]),
    })

    expect(environment.AGENT_MCP_SERVERS_JSON).toEqual([
      expect.objectContaining({
        id: 'local-docs',
        auth: { type: 'none' },
        tools: [{ name: 'lookup', riskLevel: 'read' }],
      }),
    ])
  })

  it('rejects arbitrary HTTP MCP endpoints and unsupported risk levels', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_MCP_SERVERS_JSON: JSON.stringify([
          {
            id: 'remote',
            name: 'Remote',
            url: 'http://example.com/mcp',
            tools: [{ name: 'lookup', riskLevel: 'read' }],
          },
        ]),
      }),
    ).toThrow('loopback')

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_MCP_SERVERS_JSON: JSON.stringify([
          {
            id: 'danger',
            name: 'Danger',
            url: 'https://example.com/mcp',
            tools: [{ name: 'delete_all', riskLevel: 'destructive' }],
          },
        ]),
      }),
    ).toThrow('AGENT_MCP_SERVERS_JSON')
  })

  it('requires an existing bearer token environment reference without leaking its value', () => {
    const token = 'mcp-secret-never-print'
    const key = 'TEST_DOCS_MCP_TOKEN'
    const previous = process.env[key]
    process.env[key] = token
    try {
      expect(() =>
        validateEnvironment({
          ...requiredEnvironment,
          AGENT_MCP_SERVERS_JSON: JSON.stringify([
            {
              id: 'docs',
              name: 'Docs',
              url: 'https://example.com/mcp',
              auth: { type: 'bearer', tokenEnv: key },
              tools: [{ name: 'lookup' }],
            },
          ]),
        }),
      ).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }

    try {
      validateEnvironment({
        ...requiredEnvironment,
        AGENT_MCP_SERVERS_JSON: JSON.stringify([
          {
            id: 'docs',
            name: 'Docs',
            url: 'https://example.com/mcp',
            auth: { type: 'bearer', tokenEnv: key },
            tools: [{ name: 'lookup' }],
          },
        ]),
      })
    } catch (error) {
      expect(String(error)).not.toContain(token)
      expect(String(error)).not.toContain(key)
    }
  })

  it('accepts a bearer token loaded from the environment-file configuration', () => {
    const token = 'mcp-dotenv-secret-never-print'
    const key = 'TEST_DOTENV_MCP_TOKEN'

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        [key]: token,
        AGENT_MCP_SERVERS_JSON: JSON.stringify([
          {
            id: 'dotenv-docs',
            name: 'Dotenv docs',
            url: 'https://example.com/mcp',
            auth: { type: 'bearer', tokenEnv: key },
            tools: [{ name: 'lookup' }],
          },
        ]),
      }),
    ).not.toThrow()
  })

  it('always requires the OpenSandbox connection settings', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: requiredEnvironment.DATABASE_URL,
        REDIS_URL: requiredEnvironment.REDIS_URL,
      }),
    ).toThrow('OPEN_SANDBOX_DOMAIN')

    expect(
      validateEnvironment({
        ...requiredEnvironment,
      }),
    ).toMatchObject({
      OPEN_SANDBOX_DOMAIN: '172.16.1.20:8080',
      OPEN_SANDBOX_API_KEY: 'sandbox-test-key',
      OPEN_SANDBOX_USE_SERVER_PROXY: true,
    })
  })

  it('requires complete server-only OSS configuration when the production adapter is selected', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        SKILL_OBJECT_STORE_DRIVER: 'oss',
      }),
    ).toThrow('OSS_REGION')

    const environment = validateEnvironment({
      ...requiredEnvironment,
      SKILL_OBJECT_STORE_DRIVER: 'oss',
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_BUCKET: 'private-skill-bucket',
      OSS_ACCESS_KEY_ID: 'test-access-key-id',
      OSS_ACCESS_KEY_SECRET: 'test-access-key-secret',
      OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
      OSS_INTERNAL: 'true',
    })
    expect(environment).toMatchObject({
      SKILL_OBJECT_STORE_DRIVER: 'oss',
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_BUCKET: 'private-skill-bucket',
      OSS_INTERNAL: true,
    })
  })

  it('rejects an unsafe trusted proxy hop count', () => {
    expect(() => validateEnvironment({ ...requiredEnvironment, TRUSTED_PROXY_HOPS: '6' })).toThrow(
      'TRUSTED_PROXY_HOPS',
    )
  })

  it('requires an API key when a real Chat provider is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        QWEN_ENABLED: 'true',
      }),
    ).toThrow('QWEN_API_KEY')

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        QWEN_ENABLED: 'true',
        QWEN_API_KEY: 'qwen-test-key',
      }),
    ).not.toThrow()
  })

  it.each(['QWEN', 'GLM', 'DEEPSEEK', 'KIMI'] as const)(
    'allows the %s alias to be enabled independently',
    (alias) => {
      const environment = validateEnvironment({
        ...requiredEnvironment,
        [`${alias}_ENABLED`]: 'true',
        [`${alias}_API_KEY`]: `${alias.toLowerCase()}-test-key`,
        [`${alias}_MODEL_ID`]: `${alias.toLowerCase()}-test-model`,
      })

      expect(environment[`${alias}_ENABLED`]).toBe(true)
      for (const otherAlias of ['QWEN', 'GLM', 'DEEPSEEK', 'KIMI'] as const) {
        if (otherAlias !== alias) expect(environment[`${otherAlias}_ENABLED`]).toBe(false)
      }
    },
  )

  it('requires an independent administrator session secret in production', () => {
    expect(() => validateEnvironment({ ...requiredEnvironment, NODE_ENV: 'production' })).toThrow(
      'ADMIN_SESSION_SECRET',
    )
  })

  it('requires GitHub credentials when OAuth is enabled', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, GITHUB_OAUTH_ENABLED: 'true' }),
    ).toThrow('GITHUB_CLIENT_ID')
  })

  it('requires Google credentials only when Google OAuth is enabled', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, GOOGLE_OAUTH_ENABLED: 'true' }),
    ).toThrow('GOOGLE_CLIENT_ID')

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        GOOGLE_OAUTH_ENABLED: 'true',
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
      }),
    ).not.toThrow()
  })

  it('enforces the fixed 30-day user session lifetime', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, USER_SESSION_TTL_SECONDS: '3600' }),
    ).toThrow('USER_SESSION_TTL_SECONDS')
  })

  it('allows fixed administrator credentials to be explicitly enabled in production', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        GITHUB_OAUTH_ENABLED: 'true',
        GITHUB_CLIENT_ID: 'github-client-id',
        GITHUB_CLIENT_SECRET: 'github-client-secret',
        GITHUB_CALLBACK_URL: 'https://example.com/api/v1/auth/github/callback',
        USER_SESSION_SECRET: 'production-user-session-secret-with-32-characters',
        ADMIN_SESSION_SECRET: 'production-session-secret-with-32-characters',
        ADMIN_FIXED_CREDENTIALS_ENABLED: 'true',
      }),
    ).not.toThrow()
  })

  it('allows production to run with anonymous login while OAuth providers are disabled', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        USER_SESSION_SECRET: 'production-user-session-secret-with-32-characters',
        ADMIN_SESSION_SECRET: 'production-session-secret-with-32-characters',
        ADMIN_FIXED_CREDENTIALS_ENABLED: 'false',
      }),
    ).not.toThrow()
  })

  it('does not include configured secret values in validation errors', () => {
    const secret = 'never-print-this-key'

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        QWEN_ENABLED: 'true',
        QWEN_API_KEY: secret,
      }),
    ).not.toThrow()

    try {
      validateEnvironment({
        ...requiredEnvironment,
        QWEN_ENABLED: 'true',
        QWEN_API_KEY: secret,
      })
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })

  it('does not include GitHub or session secrets in validation errors', () => {
    const githubSecret = 'github-secret-never-print'
    const sessionSecret = 'session-secret-never-print-with-32-characters'

    try {
      validateEnvironment({
        ...requiredEnvironment,
        GITHUB_OAUTH_ENABLED: 'true',
        GITHUB_CLIENT_SECRET: githubSecret,
        USER_SESSION_SECRET: sessionSecret,
      })
    } catch (error) {
      expect(String(error)).not.toContain(githubSecret)
      expect(String(error)).not.toContain(sessionSecret)
    }
  })
})
