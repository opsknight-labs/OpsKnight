import { AppError } from '@/lib/errors';
import { getUserFriendlyError } from '@/lib/user-friendly-errors';
import type { IntegrationError, IntegrationErrorCode } from './errors';

const CODE_MAP: Record<Exclude<IntegrationErrorCode, 'INTERNAL_ERROR' | 'RATE_LIMITED'>, ConstructorParameters<typeof AppError>[0]['code']> = {
  INVALID_SIGNATURE: 'INTEGRATION_SIGNATURE_INVALID',
  MISSING_SIGNATURE: 'INTEGRATION_SIGNATURE_MISSING',
  EXPIRED_TIMESTAMP: 'INTEGRATION_TIMESTAMP_EXPIRED',
  INVALID_PAYLOAD: 'INTEGRATION_PAYLOAD_INVALID',
  VALIDATION_ERROR: 'INTEGRATION_VALIDATION_FAILED',
  INTEGRATION_NOT_FOUND: 'INTEGRATION_NOT_FOUND',
  UNAUTHORIZED: 'INTEGRATION_AUTHENTICATION_FAILED',
};

/**
 * Adapt the existing integration-domain error model to the central AppError
 * boundary without changing the integration engine's internal metrics/codes.
 */
export function integrationErrorToAppError(error: IntegrationError): AppError | null {
  if (error.code === 'INTERNAL_ERROR' || error.code === 'RATE_LIMITED') return null;

  return new AppError({
    code: CODE_MAP[error.code],
    // Preserve the exact message legacy jsonError() exposed to clients.
    userMessage: getUserFriendlyError(error.message),
    details: error.details,
    cause: error,
  });
}
