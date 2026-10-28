import { incrementSharedCounter } from '@/lib/rate-limit';
import { ingestionConfig } from './config';
import { IngestionRateLimitError, IngestionUnavailableError } from './contract';

export const INGESTION_REPLAY_LIMIT = 600;
export const INGESTION_REPLAY_WINDOW_MS = 60000;

/** An authenticated, exhausted request can inspect old receipts, never append.
 * Charge this separate bounded guard before parsing/normalization. Its committed
 * counter survives content conflicts and failed receipt lookups. Namespace by
 * authenticated principal, never by the caller's chosen delivery identity.
 */
export async function reserveIngestionReplay(
  principal: string,
  deliveryKey: string | undefined,
  denied: { resetAt: number },
  wire: IngestionRateLimitError['wire']
): Promise<IngestionRateLimitError | undefined> {
  if (ingestionConfig().mode !== 'postgres' || !deliveryKey || deliveryKey.length > 1024)
    return undefined;
  try {
    const guard = await incrementSharedCounter(
      `ingestion-replay:${principal}`,
      INGESTION_REPLAY_WINDOW_MS,
      'database'
    );
    if (guard.count > INGESTION_REPLAY_LIMIT) return undefined;
    return new IngestionRateLimitError(denied.resetAt, wire);
  } catch {
    throw new IngestionUnavailableError('Shared replay guard unavailable');
  }
}
