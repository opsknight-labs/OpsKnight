import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampedIntegerEnv,
  ingestionConfig,
  MAX_INFLIGHT_REQUESTS_RANGE,
  REQUEST_WAIT_MS_RANGE,
} from '@/lib/ingestion/config';

describe('request gate environment values', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps the current defaults when unset or not a number', () => {
    expect(ingestionConfig()).toMatchObject({ maxInFlightRequests: 32, requestWaitMs: 25 });
    vi.stubEnv('OPSKNIGHT_INGESTION_MAX_INFLIGHT_REQUESTS', 'many');
    vi.stubEnv('OPSKNIGHT_INGESTION_REQUEST_WAIT_MS', '');
    expect(ingestionConfig()).toMatchObject({ maxInFlightRequests: 32, requestWaitMs: 25 });
  });

  it('reads both values from the environment', () => {
    vi.stubEnv('OPSKNIGHT_INGESTION_MAX_INFLIGHT_REQUESTS', '128');
    vi.stubEnv('OPSKNIGHT_INGESTION_REQUEST_WAIT_MS', '200');
    expect(ingestionConfig()).toMatchObject({ maxInFlightRequests: 128, requestWaitMs: 200 });
  });

  it('clamps out-of-range values instead of failing every request', () => {
    expect(clampedIntegerEnv('0', MAX_INFLIGHT_REQUESTS_RANGE)).toBe(1);
    expect(clampedIntegerEnv('99999', MAX_INFLIGHT_REQUESTS_RANGE)).toBe(1024);
    expect(clampedIntegerEnv('-5', REQUEST_WAIT_MS_RANGE)).toBe(0);
    expect(clampedIntegerEnv('60000', REQUEST_WAIT_MS_RANGE)).toBe(1000);
    vi.stubEnv('OPSKNIGHT_INGESTION_MAX_INFLIGHT_REQUESTS', '5000');
    vi.stubEnv('OPSKNIGHT_INGESTION_REQUEST_WAIT_MS', '-1');
    expect(ingestionConfig()).toMatchObject({ maxInFlightRequests: 1024, requestWaitMs: 0 });
  });
});
