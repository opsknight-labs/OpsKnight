import { AppError } from '@/lib/errors';
import { jsonError } from '@/lib/api-response';
import {
  IngestionRateLimitError,
  IngestionConflictError,
  IngestionPayloadError,
  IngestionUnavailableError,
} from './contract';

/** Common wire contract for every provider and Events API. */
export function ingestionErrorResponse(error: unknown): Response | null {
  if (error instanceof IngestionRateLimitError) {
    const retryAfter = Math.max(1, Math.ceil((error.resetAt - Date.now()) / 1000));
    if (error.wire === 'integration' || error.wire === 'pagerduty')
      return new Response(
        JSON.stringify(
          error.wire === 'pagerduty'
            ? { status: 'error', message: 'Rate limit exceeded' }
            : { error: 'RATE_LIMITED', message: 'Rate limit exceeded' }
        ),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(error.resetAt / 1000)),
          },
        }
      );
    return jsonError(
      new AppError({
        code: 'RATE_LIMIT_EXCEEDED',
        userMessage: 'Rate limit exceeded.',
        details: { retryAfter },
      }),
      undefined,
      undefined,
      { 'Retry-After': String(retryAfter) }
    );
  }
  if (error instanceof IngestionConflictError) return jsonError('Delivery key conflict', 409);
  if (error instanceof IngestionPayloadError)
    return jsonError('Ingestion envelope exceeds 2 MiB', 413);
  if (error instanceof IngestionUnavailableError) {
    return jsonError('Ingestion temporarily unavailable', 503, undefined, { 'Retry-After': '5' });
  }
  return null;
}
