import {
  ERROR_REGISTRY,
  isAppErrorCode,
  type AppErrorCode,
  type ErrorDefinition,
  type ErrorExposure,
} from './registry';

export type ErrorField = {
  field: string;
  code?: string;
  message: string;
};

export type AppErrorOptions = {
  code: AppErrorCode;
  status?: number;
  userMessage?: string;
  action?: string;
  fields?: ErrorField[];
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
  exposure?: ErrorExposure;
};

export type PublicAppError = {
  code: AppErrorCode;
  message: string;
  action?: string;
  retryable: boolean;
  fields?: ErrorField[];
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly action?: string;
  readonly fields?: ErrorField[];
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly exposure: ErrorExposure;
  readonly cause?: unknown;

  constructor(options: AppErrorOptions) {
    const definition: ErrorDefinition = ERROR_REGISTRY[options.code];
    const userMessage = options.userMessage ?? definition.userMessage;

    super(userMessage);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status ?? definition.status;
    this.userMessage = userMessage;
    this.action = options.action ?? definition.action;
    this.fields = options.fields;
    this.retryable = options.retryable ?? definition.retryable ?? false;
    this.details = options.details;
    this.exposure = options.exposure ?? definition.exposure ?? 'public';
    this.cause = options.cause;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;

  // Compatibility for existing typed errors (for example AuthorizationError)
  // while domains migrate onto AppError directly.
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code?: unknown }).code;
    if (isAppErrorCode(code)) {
      const status =
        'status' in error && typeof (error as Error & { status?: unknown }).status === 'number'
          ? (error as Error & { status: number }).status
          : undefined;

      return new AppError({
        code,
        status,
        userMessage: error.message || undefined,
        cause: error,
      });
    }
  }

  return new AppError({
    code: 'INTERNAL_ERROR',
    cause: error,
  });
}

export function toPublicAppError(error: unknown): PublicAppError {
  const appError = normalizeError(error);

  return {
    code: appError.code,
    message: appError.userMessage,
    action: appError.action,
    retryable: appError.retryable,
    fields: appError.fields,
  };
}
