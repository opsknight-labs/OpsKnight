import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ counter: vi.fn(), mode: 'postgres' }));
vi.mock('@/lib/rate-limit', () => ({ incrementSharedCounter: fixture.counter }));
vi.mock('@/lib/ingestion/config', () => ({ ingestionConfig: () => ({ mode: fixture.mode }) }));
vi.mock('@/lib/ingestion/postgres', () => ({
  acceptPostgresEvent: vi.fn(),
  replayPostgresEvent: vi.fn(),
}));
vi.mock('@/lib/ingestion/batches', () => ({ acceptPostgresBatch: vi.fn() }));
import { reserveIngestionReplay } from '@/lib/ingestion/replay';
import { withIngestionDelivery } from '@/lib/ingestion/admission';
import { assertNewIngestionWorkAllowed } from '@/lib/ingestion/delivery-context';
import { IngestionRateLimitError, IngestionUnavailableError } from '@/lib/ingestion/contract';
import { ingestionErrorResponse } from '@/lib/ingestion/http';

describe('bounded authenticated receipt recovery', () => {
  beforeEach(() => {
    fixture.mode = 'postgres';
    fixture.counter.mockReset().mockResolvedValue({ count: 1, resetAt: Date.now() + 60000 });
  });
  afterEach(() => {
    fixture.mode = 'postgres';
  });
  it('charges an independent database-clock guard scoped to the authenticated principal', async () => {
    const error = await reserveIngestionReplay(
      'integration:trusted',
      'caller-delivery',
      { resetAt: Date.now() + 1000 },
      'integration'
    );
    expect(error).toBeInstanceOf(IngestionRateLimitError);
    expect(fixture.counter).toHaveBeenCalledWith(
      'ingestion-replay:integration:trusted',
      60000,
      'database'
    );
  });
  it('requires a delivery identity, PostgreSQL mode, and remaining replay budget', async () => {
    expect(
      await reserveIngestionReplay('api:trusted', undefined, { resetAt: 1 }, 'events')
    ).toBeUndefined();
    expect(fixture.counter).not.toHaveBeenCalled();
    fixture.mode = 'sync';
    expect(
      await reserveIngestionReplay('api:trusted', 'delivery', { resetAt: 1 }, 'events')
    ).toBeUndefined();
    fixture.mode = 'postgres';
    fixture.counter.mockResolvedValue({ count: 601 });
    expect(
      await reserveIngestionReplay('api:trusted', 'delivery', { resetAt: 1 }, 'events')
    ).toBeUndefined();
  });
  it('fails closed as unavailable if the independent guard cannot commit', async () => {
    fixture.counter.mockRejectedValue(new Error('database unavailable'));
    await expect(
      reserveIngestionReplay('api:trusted', 'delivery', { resetAt: 1 }, 'events')
    ).rejects.toBeInstanceOf(IngestionUnavailableError);
  });
  it('blocks control side effects and successful no-receipt responses while preserving authentication errors', async () => {
    const denied = new IngestionRateLimitError(Date.now() + 60000, 'integration');
    await expect(
      withIngestionDelivery(
        'delivery',
        async () => {
          assertNewIngestionWorkAllowed();
        },
        denied
      )
    ).rejects.toBe(denied);
    await expect(
      withIngestionDelivery('delivery', async () => new Response('{}', { status: 200 }), denied)
    ).rejects.toBe(denied);
    const response = await withIngestionDelivery(
      'delivery',
      async () => new Response('{}', { status: 403 }),
      denied
    );
    expect(response.status).toBe(403);
    expect(() => assertNewIngestionWorkAllowed()).not.toThrow();
  });
  it('preserves provider quota response formats', async () => {
    for (const wire of ['events', 'integration', 'pagerduty'] as const) {
      const response = ingestionErrorResponse(
        new IngestionRateLimitError(Date.now() + 5000, wire)
      )!;
      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
      const body = await response.json();
      if (wire === 'integration') expect(body.error).toBe('RATE_LIMITED');
      if (wire === 'pagerduty') expect(body.status).toBe('error');
    }
  });
});
