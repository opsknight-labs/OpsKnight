import {
  AppError,
  isAppError,
  toPublicAppError,
  type AppErrorCode,
  type ErrorField,
} from '@/lib/errors';

export type ScheduleActionState = {
  error?: string;
  success?: boolean;
  code?: AppErrorCode;
  action?: string;
  retryable?: boolean;
  fields?: ErrorField[];
};

/**
 * Preserve the schedule form contract while exposing stable error metadata.
 * Unknown/internal exceptions intentionally use the caller-provided fallback
 * so Prisma, SQL, stack, and infrastructure details never cross the server
 * action boundary.
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

  return { error: fallback };
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
