const { process } = globalThis
const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl || (!databaseUrl.includes('_test') && !databaseUrl.includes('test_'))) {
  throw new Error('TEST_DATABASE_URL 必须指向名称包含 _test 或 test_ 的 PostgreSQL 测试库')
}

for (const key of ['QWEN_API_KEY', 'GLM_API_KEY', 'DEEPSEEK_API_KEY']) {
  delete process.env[key]
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: databaseUrl,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6399',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  GITHUB_OAUTH_ENABLED: 'true',
  GITHUB_CLIENT_ID: 'fixture-github-client-id',
  GITHUB_CLIENT_SECRET: 'fixture-github-client-secret',
  GITHUB_CALLBACK_URL: 'http://127.0.0.1:3001/api/v1/auth/github/callback',
  GOOGLE_OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'fixture-google-client-id',
  GOOGLE_CLIENT_SECRET: 'fixture-google-client-secret',
  GOOGLE_CALLBACK_URL: 'http://127.0.0.1:3001/api/v1/auth/google/callback',
  USER_SESSION_SECRET: 'fixture-user-session-secret-with-at-least-32-characters',
  USER_SESSION_TTL_SECONDS: '2592000',
  MOCK_PROVIDER_ENABLED: 'true',
  QWEN_ENABLED: 'false',
  GLM_ENABLED: 'false',
  DEEPSEEK_ENABLED: 'false',
})
