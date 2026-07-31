import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createPinoHttpOptions() {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.query.code',
        'req.query.state',
        'res.headers.set-cookie',
        '*.apiKey',
        '*.api_key',
        '*.password',
        '*.secret',
        '*.clientSecret',
        '*.accessToken',
        '*.access_token',
        '*.sessionToken',
        '*.tokenHash',
        '*.email',
      ],
      censor: '[REDACTED]',
    },
    genReqId(request: IncomingMessage, response: ServerResponse) {
      const incomingId = request.headers['x-request-id']
      const requestId =
        typeof incomingId === 'string' && UUID_PATTERN.test(incomingId) ? incomingId : randomUUID()
      response.setHeader('x-request-id', requestId)
      return requestId
    },
    customLogLevel(_request: IncomingMessage, response: ServerResponse, error?: Error) {
      if (error || response.statusCode >= 500) return 'error' as const
      if (response.statusCode >= 400) return 'warn' as const
      // 成功请求会在页面初始化和轮询期间大量出现；业务生命周期日志仍由 Nest Logger 保留。
      return 'silent' as const
    },
  }
}
