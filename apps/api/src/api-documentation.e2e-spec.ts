import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { ADMIN_SESSION_COOKIE } from './admin/auth/admin-auth.service'
import { AppModule } from './app.module'
import { configureApiDocumentation } from './api-documentation'
import { configureApplication } from './configure-app'
import { USER_SESSION_COOKIE } from './user-auth/user-auth.constants'

describe('OpenAPI authentication documentation E2E', () => {
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = testingModule.createNestApplication()
    configureApplication(app)
    configureApiDocumentation(app)
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it('publishes separate user/admin cookie schemes without a public email field', async () => {
    const response = await fetch(`${baseUrl}/api-docs/openapi.json`)
    expect(response.status).toBe(200)
    const document = (await response.json()) as Record<string, unknown>
    const serialized = JSON.stringify(document)

    expect(document).toMatchObject({
      components: {
        securitySchemes: {
          [USER_SESSION_COOKIE]: { type: 'apiKey', in: 'cookie', name: USER_SESSION_COOKIE },
          [ADMIN_SESSION_COOKIE]: { type: 'apiKey', in: 'cookie', name: ADMIN_SESSION_COOKIE },
        },
      },
      paths: {
        '/api/v1/auth/session': {
          get: { security: [{ [USER_SESSION_COOKIE]: [] }] },
        },
        '/api/v1/admin/logs': {
          get: { security: [{ [ADMIN_SESSION_COOKIE]: [] }] },
        },
      },
    })
    expect(serialized).not.toContain('GITHUB_CLIENT_SECRET')
    expect(serialized).not.toContain('accessToken')
    const paths = document.paths as Record<string, { get?: unknown }>
    expect(paths['/api/v1/chat/completions']).toBeUndefined()
    expect(JSON.stringify(paths['/api/v1/auth/session']?.get)).not.toContain('"email"')
  })
})
