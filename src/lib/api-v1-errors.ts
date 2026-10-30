import 'server-only';
import { z } from 'zod/v3';
import { jsonError } from '@/lib/api-response';
import { isAppError, normalizeError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Error boundary for /api/v1 handlers. Authentication/authorization and validation failures keep
 * their 401/403/400 meaning instead of escaping as framework 500s; anything unexpected is logged
 * and answered with a generic 500 that exposes no internals.
 */
export function v1ErrorResponse(error: unknown, operation: string) {
  if (error instanceof z.ZodError) {
    return jsonError('Validation failed', 400, { details: error.errors });
  }
  const appError = isAppError(error) ? error : normalizeError(error);
  if (appError.code !== 'INTERNAL_ERROR' && appError.exposure !== 'internal') {
    return jsonError(appError);
  }
  logger.error(`${operation} failed`, { error });
  return jsonError(`Failed to ${operation}`, 500);
}
