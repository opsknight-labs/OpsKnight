/**
 * Integration Error Types
 *
 * Structured error types for better error handling and client responses.
 */

export type IntegrationErrorCode =
  | 'INVALID_SIGNATURE'
  | 'MISSING_SIGNATURE'
  | 'EXPIRED_TIMESTAMP'
  | 'RATE_LIMITED'
  | 'INVALID_PAYLOAD'
  | 'VALIDATION_ERROR'
  | 'INTEGRATION_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  readonly retryAfter?: number;

  constructor(
    code: IntegrationErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      details?: Record<string, unknown>;
      retryAfter?: number;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.statusCode = options?.statusCode ?? this.getDefaultStatusCode(code);
    this.details = options?.details;
    this.retryAfter = options?.retryAfter;

    if (options?.cause) {
      this.cause = options.cause;
    }

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, IntegrationError);
  }

  private getDefaultStatusCode(code: IntegrationErrorCode): number {
    switch (code) {
      case 'INVALID_SIGNATURE':
      case 'MISSING_SIGNATURE':
      case 'EXPIRED_TIMESTAMP':
      case 'UNAUTHORIZED':
        return 401;
      case 'RATE_LIMITED':
        return 429;
      case 'INVALID_PAYLOAD':
      case 'VALIDATION_ERROR':
        return 400;
      case 'INTEGRATION_NOT_FOUND':
        return 404;
      case 'INTERNAL_ERROR':
      default:
        return 500;
    }
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
      retryAfter: this.retryAfter,
    };
  }
}

/**
 * Factory functions for common errors
 */
export const IntegrationErrors = {
  invalidSignature: (details?: Record<string, unknown>) =>
    new IntegrationError('INVALID_SIGNATURE', 'Webhook signature verification failed', { details }),

  missingSignature: (header: string) =>
    new IntegrationError('MISSING_SIGNATURE', `Missing required signature header: ${header}`),

  expiredTimestamp: (ageSeconds: number) =>
    new IntegrationError('EXPIRED_TIMESTAMP', `Webhook timestamp expired (${ageSeconds}s old)`, {
      details: { ageSeconds },
    }),

  rateLimited: (retryAfter: number) =>
    new IntegrationError('RATE_LIMITED', 'Rate limit exceeded', { retryAfter }),

  invalidPayload: (message: string, details?: Record<string, unknown>) =>
    new IntegrationError('INVALID_PAYLOAD', message, { details }),

  validationError: (errors: Array<{ path: string; message: string }>) =>
    new IntegrationError('VALIDATION_ERROR', 'Payload validation failed', {
      details: { errors },
    }),

  notFound: (integrationId: string) =>
    new IntegrationError('INTEGRATION_NOT_FOUND', `Integration not found: ${integrationId}`),

  unauthorized: (reason?: string) => new IntegrationError('UNAUTHORIZED', reason || 'Unauthorized'),

  internal: (message: string, cause?: Error) =>
    new IntegrationError('INTERNAL_ERROR', message, { cause }),
};

/**
 * Type guard to check if an error is an IntegrationError
 */
export function isIntegrationError(error: unknown): error is IntegrationError {
  return error instanceof IntegrationError;
}

/**
 * Convert IntegrationError to HTTP response format
 */
export function integrationErrorToResponse(error: IntegrationError) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (error.retryAfter) {
    headers['Retry-After'] = String(error.retryAfter);
  }

  return {
    status: error.statusCode,
    headers,
    body: JSON.stringify(error.toJSON()),
  };
}
