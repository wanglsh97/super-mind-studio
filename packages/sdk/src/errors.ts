import type { GatewayError } from './types.js';

export class AIGatewayError extends Error implements GatewayError {
  readonly requestId: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(error: GatewayError, options: { status?: number; cause?: unknown } = {}) {
    super(error.message, { cause: options.cause });
    this.name = 'AIGatewayError';
    this.requestId = error.requestId;
    this.code = error.code;
    this.retryable = error.retryable;
    if (error.details !== undefined) this.details = error.details;
    if (options.status !== undefined) this.status = options.status;
  }
}

export class AIGatewayProtocolError extends AIGatewayError {
  constructor(requestId: string, message: string, cause?: unknown) {
    super(
      {
        requestId,
        code: 'INVALID_STREAM_RESPONSE',
        message,
        retryable: true,
      },
      { cause },
    );
    this.name = 'AIGatewayProtocolError';
  }
}

export class AIGatewayAuthenticationError extends AIGatewayError {
  constructor(error: GatewayError, options: { cause?: unknown } = {}) {
    super(
      {
        ...error,
        code: error.code || 'UNAUTHORIZED',
        retryable: false,
      },
      { status: 401, ...options },
    );
    this.name = 'AIGatewayAuthenticationError';
  }
}

export class AIGatewayFeatureUnavailableError extends AIGatewayError {
  constructor(feature: string) {
    super({
      requestId: 'unavailable',
      code: 'SDK_FEATURE_UNAVAILABLE',
      message: `SDK feature "${feature}" is not implemented yet`,
      retryable: false,
    });
    this.name = 'AIGatewayFeatureUnavailableError';
  }
}

export class AIGatewayTimeoutError extends AIGatewayError {
  constructor(operation: string, timeoutMs: number) {
    super({
      requestId: 'timeout',
      code: 'SDK_TIMEOUT',
      message: `${operation} timed out after ${timeoutMs}ms`,
      retryable: true,
      details: { timeoutMs },
    });
    this.name = 'AIGatewayTimeoutError';
  }
}
