import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, HttpStatus } from '@nestjs/common'
import type { Request, Response } from 'express'

type RequestWithId = Request & { id?: string }

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const request = context.getRequest<RequestWithId>()
    const response = context.getResponse<Response>()
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const requestId = request.id ?? response.getHeader('x-request-id')?.toString() ?? 'unknown'

    const body = exception instanceof HttpException ? exception.getResponse() : undefined
    const bodyRecord =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined
    const rawMessage = bodyRecord?.message ?? (typeof body === 'string' ? body : undefined)
    const details =
      typeof bodyRecord?.details === 'object' && bodyRecord.details !== null
        ? (bodyRecord.details as Record<string, unknown>)
        : undefined
    const multerFileTooLarge =
      bodyRecord?.code === 'LIMIT_FILE_SIZE' || rawMessage === 'File too large'
    const message = multerFileTooLarge
      ? '单个文件不能超过 20 MB，请压缩文件后重试。'
      : Array.isArray(rawMessage)
      ? rawMessage.filter((item): item is string => typeof item === 'string').join('; ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : status >= 500
          ? '服务暂时不可用'
          : '请求失败'

    const retryAfterSeconds = details?.retryAfterSeconds
    if (status === 429 && typeof retryAfterSeconds === 'number') {
      response.setHeader('retry-after', String(retryAfterSeconds))
    }

    response.status(status).json({
      requestId,
      code: multerFileTooLarge
        ? 'DOCUMENT_FILE_TOO_LARGE'
        : typeof bodyRecord?.code === 'string' && bodyRecord.code
          ? bodyRecord.code
          : this.toCode(status),
      message,
      retryable:
        typeof bodyRecord?.retryable === 'boolean'
          ? bodyRecord.retryable
          : status === 429 || status >= 500,
      ...(details === undefined ? {} : { details }),
    })
  }

  private toCode(status: number) {
    if (status === 400) return 'INVALID_REQUEST'
    if (status === 401) return 'UNAUTHORIZED'
    if (status === 403) return 'FORBIDDEN'
    if (status === 404) return 'NOT_FOUND'
    if (status === 429) return 'RATE_LIMITED'
    if (status >= 500) return 'INTERNAL_ERROR'
    return 'REQUEST_FAILED'
  }
}
