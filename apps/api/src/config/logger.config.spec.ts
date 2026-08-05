import type { IncomingMessage, ServerResponse } from 'node:http'
import pino from 'pino'

import { createPinoHttpOptions } from './logger.config'

describe('request ID generation', () => {
  it('does not add invalid trace context to logs', () => {
    expect(createPinoHttpOptions().mixin()).toEqual({})
  })

  it('preserves a valid UUID request ID', () => {
    const incomingId = '00000000-0000-4000-8000-000000000004'
    const response = { setHeader: jest.fn() } as unknown as ServerResponse

    const requestId = createPinoHttpOptions().genReqId(
      { headers: { 'x-request-id': incomingId } } as unknown as IncomingMessage,
      response,
    )

    expect(requestId).toBe(incomingId)
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', incomingId)
  })

  it('replaces a non-UUID request ID before it reaches PostgreSQL', () => {
    const response = { setHeader: jest.fn() } as unknown as ServerResponse

    const requestId = createPinoHttpOptions().genReqId(
      { headers: { 'x-request-id': 'not-a-uuid' } } as unknown as IncomingMessage,
      response,
    )

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', requestId)
  })
})

describe('authentication log redaction', () => {
  it('redacts OAuth codes, state, cookies, and token-shaped fields', () => {
    expect(createPinoHttpOptions().redact.paths).toEqual(
      expect.arrayContaining([
        'req.query.code',
        'req.query.state',
        'req.headers.cookie',
        '*.accessToken',
        '*.sessionToken',
        '*.tokenHash',
        '*.email',
      ]),
    )
  })

  it('removes user email and authentication credentials from serialized logs', () => {
    let output = ''
    const logger = pino(
      { redact: createPinoHttpOptions().redact },
      { write: (message: string) => (output += message) },
    )

    logger.info({
      user: { email: 'private-octocat@example.test' },
      auth: {
        accessToken: 'github-access-token',
        sessionToken: 'user-session-token',
      },
      req: {
        headers: { cookie: 'aigateway_user_session=secret-cookie' },
        query: { code: 'oauth-code', state: 'oauth-state' },
      },
    })

    for (const secret of [
      'private-octocat@example.test',
      'github-access-token',
      'user-session-token',
      'secret-cookie',
      'oauth-code',
      'oauth-state',
    ]) {
      expect(output).not.toContain(secret)
    }
  })
})

describe('preview capability logging', () => {
  it('disables automatic request logs for capability-bearing preview paths', () => {
    const options = createPinoHttpOptions()

    expect(
      options.autoLogging.ignore({ url: '/api/v1/agent/preview/secret/index.html' } as never),
    ).toBe(true)
    expect(options.autoLogging.ignore({ url: '/api/v1/agent/runs/run-1/preview' } as never)).toBe(
      false,
    )
  })
})

describe('HTTP access-log levels', () => {
  const request = {} as IncomingMessage

  it('suppresses successful access logs without affecting business logger output', () => {
    expect(
      createPinoHttpOptions().customLogLevel(request, { statusCode: 200 } as ServerResponse),
    ).toBe('silent')
    expect(
      createPinoHttpOptions().customLogLevel(request, { statusCode: 304 } as ServerResponse),
    ).toBe('silent')
  })

  it('keeps client and server failures visible', () => {
    expect(
      createPinoHttpOptions().customLogLevel(request, { statusCode: 401 } as ServerResponse),
    ).toBe('warn')
    expect(
      createPinoHttpOptions().customLogLevel(request, { statusCode: 500 } as ServerResponse),
    ).toBe('error')
    expect(
      createPinoHttpOptions().customLogLevel(
        request,
        { statusCode: 200 } as ServerResponse,
        new Error('connection reset'),
      ),
    ).toBe('error')
  })
})
