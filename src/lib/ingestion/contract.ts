import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';

/** Versioned storage contract. Never persist credentials or request headers. */
export const StoredEnvelope = z
  .object({
    version: z.literal(1),
    serviceId: z.string().min(1).max(512),
    integrationId: z.string().min(1).max(512),
    integrationType: z.string().min(1).max(128),
    receivedAt: z.string().datetime(),
    event: z
      .object({
        event_action: z.enum(['trigger', 'resolve', 'acknowledge']),
        dedup_key: z.string().max(8192),
        payload: z
          .object({
            summary: z.string().max(100000),
            source: z.string().max(10000),
            severity: z.enum(['critical', 'error', 'warning', 'info']),
            custom_details: z.unknown().optional(),
          })
          .strict(),
      })
      .strict(),
    providerPayload: z.unknown(),
    automationSnapshot: z
      .object({
        mode: z.enum(['DISABLED', 'SHADOW', 'LIVE']),
        activeVersionId: z.string().nullable(),
        candidateVersionId: z.string().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type StoredEnvelope = z.infer<typeof StoredEnvelope>;
export type Acceptance = { action: 'accepted'; receiptId: string; incident?: never };
export type ProcessingLease = { id: string; token: string };

export class IngestionUnavailableError extends Error {}
export class IngestionConflictError extends Error {}
export class IngestionLeaseLostError extends Error {}
export class IngestionPayloadError extends Error {}

export function digest(value: unknown): string {
  // Canonical object ordering makes idempotency independent of JSON key order.
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)])
      );
    }
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function encodeEnvelope(input: IntegrationEventEnvelope): StoredEnvelope {
  // JSON round-trip rejects non-serializable payloads before durable acceptance.
  const serialized = JSON.stringify({
    ...input,
    version: 1,
    receivedAt: input.receivedAt.toISOString(),
  });
  if (Buffer.byteLength(serialized) > 256 * 1024)
    throw new IngestionPayloadError('Ingestion envelope exceeds 256 KiB');
  return StoredEnvelope.parse(JSON.parse(serialized));
}

export function decodeEnvelope(input: unknown): IntegrationEventEnvelope {
  const { version: _version, receivedAt, ...envelope } = StoredEnvelope.parse(input);
  return {
    ...envelope,
    providerPayload: envelope.providerPayload ?? null,
    receivedAt: new Date(receivedAt),
  };
}

export function partitionKey(envelope: StoredEnvelope): string {
  const key =
    envelope.event.dedup_key.trim() ||
    digest({
      source: envelope.event.payload.source,
      summary: envelope.event.payload.summary,
      details: envelope.event.payload.custom_details ?? null,
    });
  return digest([envelope.serviceId, envelope.integrationId, key]);
}

export function retryDelayMs(attempt: number, random = Math.random()): number {
  return Math.floor(
    Math.min(300000, 1000 * 2 ** Math.min(Math.max(attempt - 1, 0), 9)) * (0.5 + random * 0.5)
  );
}
