import { jsonError } from '@/lib/api-response';
import {
  IngestionConflictError,
  IngestionPayloadError,
  IngestionUnavailableError,
} from './contract';

/** Common wire contract for every provider and Events API. */
export function ingestionErrorResponse(error: unknown): Response | null {
  if (error instanceof IngestionConflictError) return jsonError('Delivery key conflict', 409);
  if (error instanceof IngestionPayloadError)
    return jsonError('Ingestion envelope exceeds 256 KiB', 413);
  if (error instanceof IngestionUnavailableError) {
    return jsonError('Ingestion temporarily unavailable', 503, undefined, { 'Retry-After': '5' });
  }
  return null;
}
