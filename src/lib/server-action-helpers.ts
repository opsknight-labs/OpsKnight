/**
 * Helper utilities for server actions to provide consistent error handling
 * and user-friendly error messages.
 */

import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { isAppError } from './errors';
import { getUserFriendlyError } from './user-friendly-errors';

/**
 * Wraps a server action with error handling that converts legacy errors to
 * user-friendly messages while preserving typed AppError identity.
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(action: T): T {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return (async (...args: Parameters<T>) => {
    try {
      return await action(...args);
    } catch (error: unknown) {
      if (isRedirectError(error)) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'digest' in error &&
        (error as any).digest === 'NEXT_NOT_FOUND'
      )
        throw error;

      // Typed application errors already contain safe public messaging and
      // machine-readable identity. Do not flatten them back into plain Error.
      if (isAppError(error)) throw error;

      // If it's already a state object with error, return it using the legacy
      // string contract until individual server actions adopt structured state.
      if (error && typeof error === 'object' && 'error' in error) {
        return {
          ...error,
          error: getUserFriendlyError((error as any).error), // eslint-disable-line @typescript-eslint/no-explicit-any
        };
      }

      throw new Error(getUserFriendlyError(error));
    }
  }) as T;
}

/**
 * Creates an error state object for form actions.
 */
export function createErrorState(error: unknown): { error: string } {
  return {
    error: getUserFriendlyError(error),
  };
}

/**
 * Creates a success state object for form actions.
 */
export function createSuccessState<T = Record<string, never>>(data?: T): { success: true } & T {
  return {
    success: true,
    ...(data || {}),
  } as { success: true } & T;
}
