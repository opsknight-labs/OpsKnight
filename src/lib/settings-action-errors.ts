import {
  ERROR_REGISTRY,
  isAppError,
  isAppErrorCode,
  toPublicAppError,
  type ErrorDefinition,
} from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  isSettingsChangedError,
  SETTINGS_CHANGED_MESSAGE,
  type SettingsActionErrorCode,
} from '@/lib/settings-result';

export type SettingsActionFailure = {
  success: false;
  error: string;
  code: SettingsActionErrorCode;
  /** Correlation id written to the server log for unexpected failures. */
  reference?: string;
};

function hasRegisteredCode(error: unknown): boolean {
  return (
    isAppError(error) ||
    (error instanceof Error &&
      'code' in error &&
      isAppErrorCode((error as Error & { code?: unknown }).code))
  );
}

function settingsCodeFor(code: string): SettingsActionErrorCode {
  if (!isAppErrorCode(code)) return 'INTERNAL_ERROR';
  // code is narrowed to a key of the closed error registry.
  // eslint-disable-next-line security/detect-object-injection
  const definition: ErrorDefinition = ERROR_REGISTRY[code];
  switch (definition.category) {
    case 'authentication':
    case 'authorization':
      return 'FORBIDDEN';
    case 'validation':
    case 'not_found':
      return 'VALIDATION_ERROR';
    case 'conflict':
      return 'SETTINGS_CHANGED';
    case 'dependency':
    case 'network':
    case 'rate_limit':
      return 'PROVIDER_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

function newReference(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

/**
 * Convert anything a settings server action throws into a serializable failure.
 *
 * Next.js production builds replace the message of an error thrown from a
 * server action with React error #441 and a digest, so settings actions must
 * return their failure instead of throwing it. Only AppError user messages and
 * the shared settings-changed message cross the boundary; anything else is
 * logged with a short reference and reported with a generic message.
 */
export function settingsActionFailure(
  error: unknown,
  options: { operation: string; fallback: string }
): SettingsActionFailure {
  if (isSettingsChangedError(error)) {
    return { success: false, code: 'SETTINGS_CHANGED', error: SETTINGS_CHANGED_MESSAGE };
  }

  if (hasRegisteredCode(error)) {
    const publicError = toPublicAppError(error);
    if (
      publicError.code === 'PRECONDITION_FAILED' ||
      publicError.code === 'PRECONDITION_REQUIRED'
    ) {
      // The registry text describes HTTP If-Match semantics; the settings UI
      // tracks revisions itself, so tell the administrator what to do instead.
      return { success: false, code: 'SETTINGS_CHANGED', error: SETTINGS_CHANGED_MESSAGE };
    }
    if (publicError.code !== 'INTERNAL_ERROR') {
      return {
        success: false,
        code: settingsCodeFor(publicError.code),
        error: publicError.message,
      };
    }
  }

  const reference = newReference();
  logger.error(`settings.${options.operation}_failed`, {
    component: 'settings-actions',
    reference,
    error,
  });
  return {
    success: false,
    code: 'INTERNAL_ERROR',
    error: `${options.fallback} If the problem continues, contact support with reference ${reference}.`,
    reference,
  };
}
