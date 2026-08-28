import {
  AppError,
  isAppError,
  toPublicAppError,
  type AppErrorCode,
  type ErrorField,
} from '@/lib/errors';

export type ScheduleActionState = {
  error?: string | null;
  success?: boolean;
  code?: AppErrorCode;
  action?: string;
  retryable?: boolean;
  fields?: ErrorField[];
};

/**
 * Preserve the existing schedule form contract while exposing stable error
 * metadata to clients that are ready to consume it.
 */
export function scheduleActionError(error: unknown, fallback: string): ScheduleActionState {
  if (isAppError(error)) {
    const publicError = toPublicAppError(error);
    return {
      error: publicError.message,
      code: publicError.code,
      action: publicError.action,
      retryable: publicError.retryable,
      fields: publicError.fields,
    };
  }

  return {
    error: error instanceof Error ? error.message : fallback,
  };
}

export function scheduleValidationError(
  message: string,
  fields?: ErrorField[]
): ScheduleActionState {
  return scheduleActionError(
    new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: message,
      fields,
    }),
    message
  );
}
