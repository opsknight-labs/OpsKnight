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
    // HTTP semantics are registry-owned for first-class AppError instances.
    // Callers cannot create the same machine code with conflicting statuses.
    this.status = definition.status;
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
  // while domains migrate onto AppError directly. Once a legacy code maps to
  // the registry, the registry owns its HTTP status as well.
  if (error instanceof Error && 'code' in error) {
    const code = (error as Error & { code?: unknown }).code;
    if (isAppErrorCode(code)) {
      return new AppError({
        code,
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

  // `internal` is an enforceable serialization boundary, not metadata.
  // Never expose caller-supplied message/action/fields for an internal error.
  if (appError.exposure === 'internal') {
    const definition: ErrorDefinition = ERROR_REGISTRY.INTERNAL_ERROR;
    return {
      code: 'INTERNAL_ERROR',
      message: definition.userMessage,
      action: definition.action,
      retryable: definition.retryable ?? false,
      fields: undefined,
    };
  }

  return {
    code: appError.code,
    message: appError.userMessage,
    action: appError.action,
    retryable: appError.retryable,
    fields: appError.fields,
  };
}
