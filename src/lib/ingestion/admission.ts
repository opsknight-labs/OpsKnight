import { AsyncLocalStorage } from 'node:async_hooks';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { acceptPostgresEvent } from './postgres';
import {
  IngestionConflictError,
  IngestionPayloadError,
  IngestionUnavailableError,
} from './contract';

const deliveries = new AsyncLocalStorage<{ key?: string; ordinal: number }>();

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
  operation: () => Promise<T>
): Promise<T> {
  return deliveries.run({ key, ordinal: 0 }, operation);
}

export async function acceptIntegrationEvent(envelope: IntegrationEventEnvelope) {
  const delivery = deliveries.getStore();
  const key = delivery?.key ? `${delivery.key}:${delivery.ordinal++}` : undefined;
  try {
    return await acceptPostgresEvent(envelope, key);
  } catch (error) {
    if (
      error instanceof IngestionConflictError ||
      error instanceof IngestionPayloadError ||
      error instanceof IngestionUnavailableError
    )
      throw error;
    // An unavailable database must never turn into an optimistic acceptance.
    throw new IngestionUnavailableError('Durable ingestion unavailable');
  }
}
