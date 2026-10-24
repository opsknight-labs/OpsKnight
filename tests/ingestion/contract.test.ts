import { describe, expect, it } from 'vitest';
import { resolveIngestionMode } from '@/lib/ingestion/mode';
import {
  decodeEnvelope,
  digest,
  encodeEnvelope,
  partitionKey,
  retryDelayMs,
} from '@/lib/ingestion/contract';
import { ingestionConfig } from '@/lib/ingestion/config';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';

const envelope: IntegrationEventEnvelope = {
  serviceId: 'service',
  integrationId: 'integration',
  integrationType: 'WEBHOOK',
  receivedAt: new Date(),
  event: {
    event_action: 'trigger',
    dedup_key: 'outage',
    payload: { summary: 'Down', source: 'host', severity: 'critical' },
  },
  providerPayload: { state: 'down' },
};

describe('durable ingestion contract', () => {
  it('round trips the original acceptance time and provider fields', () => {
    expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
  });
  it('filters provider and normalized credentials while preserving Automation contact context', () => {
    const encoded = encodeEnvelope({
      ...envelope,
      event: {
        ...envelope.event,
        payload: {
          ...envelope.event.payload,
          summary: 'Bearer secret-value',
          source: 'postgresql://user:secret-password@host/db',
          custom_details: { owner: 'oncall@example.test', api_key: 'secret-api' },
        },
      },
      providerPayload: { raw: { routing_key: 'secret-routing' } },
    });
    expect(JSON.stringify(encoded)).not.toContain('secret-');
    expect(encoded.event.payload.custom_details).toEqual({
      owner: 'oncall@example.test',
      api_key: '[REDACTED]',
    });
  });

  it('keeps one partition across transitions and separates services and integrations', () => {
    const encoded = encodeEnvelope(envelope);
    expect(partitionKey(encoded)).toBe(
      partitionKey({ ...encoded, event: { ...encoded.event, event_action: 'resolve' } })
    );
    expect(partitionKey(encoded)).not.toBe(partitionKey({ ...encoded, serviceId: 'other' }));
    expect(partitionKey(encoded)).not.toBe(partitionKey({ ...encoded, integrationId: 'other' }));
  });
  it('rejects unknown envelope versions and oversized payloads before acceptance', () => {
    expect(() => decodeEnvelope({ ...encodeEnvelope(envelope), version: 2 })).toThrow();
    expect(() =>
      encodeEnvelope({ ...envelope, providerPayload: 'x'.repeat(2 * 1024 * 1024) })
    ).toThrow(/2 MiB/);
  });
  it('canonicalizes nested object keys without changing array order', () => {
    expect(digest({ a: 1, b: { x: 1, y: 2 } })).toBe(digest({ b: { y: 2, x: 1 }, a: 1 }));
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
  });
  it('bounds retries and introduces jitter', () => {
    expect(retryDelayMs(1, 0)).toBe(500);
    expect(retryDelayMs(1, 1)).toBe(1000);
    expect(retryDelayMs(100, 1)).toBe(300000);
  });
  it('defaults to durable ingestion without a customer variable and retains explicit rollback', () => {
    const previous = process.env.OPSKNIGHT_INGESTION_MODE;
    delete process.env.OPSKNIGHT_INGESTION_MODE;
    try {
      expect(ingestionConfig().mode).toBe('postgres');
      process.env.OPSKNIGHT_INGESTION_MODE = 'sync';
      expect(ingestionConfig().mode).toBe('sync');
      process.env.OPSKNIGHT_INGESTION_MODE = 'postgres';
      expect(ingestionConfig().mode).toBe('postgres');
      expect(resolveIngestionMode('sync')).toBe('sync');
      expect(() => resolveIngestionMode('invalid')).toThrow('Invalid ingestion mode');
    } finally {
      if (previous === undefined) delete process.env.OPSKNIGHT_INGESTION_MODE;
      else process.env.OPSKNIGHT_INGESTION_MODE = previous;
    }
  });
});
