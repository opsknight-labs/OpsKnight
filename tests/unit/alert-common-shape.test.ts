import { describe, expect, it } from 'vitest';
import { normalizeAlertShape } from '@/lib/alerts/normalization';

describe('common alert metadata', () => {
  it('normalizes provider severity, resources and safe labels', () => {
    expect(
      normalizeAlertShape({
        summary: 'Database pool exhausted',
        severity: 'SEV1',
        custom_details: { resource: 'postgres/checkout', env: 'PROD', apiKey: 'private-key' },
      })
    ).toMatchObject({
      severity: 'critical',
      resourceKey: 'postgres/checkout',
      labels: { resource: 'postgres/checkout', env: 'prod' },
    });
    expect(
      JSON.stringify(
        normalizeAlertShape({
          summary: 'Error',
          custom_details: { password: 'private-secret', env: 'prod' },
        })
      )
    ).not.toContain('private-secret');
  });
  it('gives recurring templates the same fingerprint despite volatile values', () => {
    const first = normalizeAlertShape({
      summary: 'Pool exhausted on db-primary-1',
      severity: 'warning',
    });
    const second = normalizeAlertShape({
      summary: 'Pool exhausted on db-primary-7',
      severity: 'critical',
    });
    expect(first.fingerprintHash).toMatch(/^[a-f0-9]{32}$/);
    expect(second.fingerprintHash).toBe(first.fingerprintHash);
    expect(normalizeAlertShape({ summary: 'Disk full' }).fingerprintHash).not.toBe(
      first.fingerprintHash
    );
  });
  it('bounds labels and handles absent metadata', () => {
    const value = normalizeAlertShape({
      summary: '',
      custom_details: Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [`key-${i}`, `value-${i}`])
      ),
    });
    expect(Object.keys(value.labels)).toHaveLength(32);
    expect(value.fingerprintHash).toBeNull();
    expect(normalizeAlertShape({ summary: 'Error' })).toMatchObject({
      severity: 'warning',
      resourceKey: null,
      labels: {},
    });
  });
  it('bounds traversal even when thousands of candidate values are unusable', () => {
    let reads = 0;
    const details = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [`empty-${i}`, null])
    );
    for (const key of Object.keys(details))
      Object.defineProperty(details, key, {
        enumerable: true,
        get() {
          reads++;
          return null;
        },
      });
    expect(normalizeAlertShape({ summary: 'Error', custom_details: details }).labels).toEqual({});
    expect(reads).toBeLessThanOrEqual(256);
    expect(
      normalizeAlertShape({ summary: 'Error', custom_details: { oversized: 'x'.repeat(1000000) } })
        .labels
    ).toEqual({});
  });
});
