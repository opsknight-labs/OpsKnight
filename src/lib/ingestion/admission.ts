import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { ingestionDeliveries as deliveries } from './delivery-context';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { acceptPostgresBatch } from './batches';
import { acceptPostgresEvent, replayPostgresEvent } from './postgres';
import {
  IngestionRateLimitError,
  IngestionConflictError,
  IngestionPayloadError,
  IngestionUnavailableError,
} from './contract';

export function ingestionDeliveryKey(headers: Headers, provider: string): string | undefined {
  const explicit = headers.get('idempotency-key');
  if (explicit) return `explicit:${explicit}`;
  if (provider === 'GITHUB')
    return headers.get('x-github-delivery') ?? headers.get('x-gitlab-event-uuid') ?? undefined;
  if (provider === 'GRAFANA')
    return headers.get('x-request-id') ?? headers.get('x-grafana-delivery') ?? undefined;
  if (provider === 'SENTRY') {
    const timestamp = headers.get('sentry-hook-timestamp');
    const signature = headers.get('sentry-hook-signature');
    return timestamp && signature ? `${timestamp}:${signature}` : undefined;
  }
  return undefined;
}

/** Provider delivery IDs identify a request; ordinal identifies each normalized event. */
export function withIngestionDelivery<T>(
  key: string | undefined,
  operation: () => Promise<T>,
  replayOnly?: IngestionRateLimitError
): Promise<T> {
  return deliveries.run({ key, ordinal: 0, replayOnly, replayed: 0 }, async () => {
    const result = await operation();
    if (
      replayOnly &&
      !deliveries.getStore()?.replayed &&
      (!(result instanceof Response) || result.ok)
    )
      throw replayOnly;
    return result;
  });
}

export async function acceptIntegrationEvent(envelope: IntegrationEventEnvelope) {
  const delivery = deliveries.getStore();
  const key = delivery?.key ? `${delivery.key}:${delivery.ordinal++}` : undefined;
  try {
    if (delivery?.replayOnly) {
      const result = await replayPostgresEvent(envelope, key, delivery.replayOnly);
      delivery.replayed += 1;
      addOperationalMetric('opsknight_ingestion_acceptance_total', 1, { outcome: 'duplicate' });
      return result;
    }
    return await acceptPostgresEvent(envelope, key);
  } catch (error) {
    if (
      error instanceof IngestionRateLimitError ||
      error instanceof IngestionConflictError ||
      error instanceof IngestionPayloadError ||
      error instanceof IngestionUnavailableError
    )
      throw error;
    // An unavailable database must never turn into an optimistic acceptance.
    throw new IngestionUnavailableError('Durable ingestion unavailable');
  }
}

export async function acceptIntegrationBatch(
  input: Omit<IntegrationEventEnvelope, 'event'>,
  events: IntegrationEventEnvelope['event'][]
) {
  const delivery = deliveries.getStore();
  const keys = events.map(() =>
    delivery?.key ? `${delivery.key}:${delivery.ordinal++}` : undefined
  );
  try {
    const result = await acceptPostgresBatch(input, events, keys, delivery?.replayOnly);
    if (delivery?.replayOnly) {
      delivery.replayed += result.length;
      addOperationalMetric('opsknight_ingestion_acceptance_total', result.length, {
        outcome: 'duplicate',
      });
    }
    return result;
  } catch (error) {
    if (
      error instanceof IngestionRateLimitError ||
      error instanceof IngestionConflictError ||
      error instanceof IngestionPayloadError ||
      error instanceof IngestionUnavailableError
    )
      throw error;
    throw new IngestionUnavailableError('Durable batch ingestion unavailable');
  }
}
