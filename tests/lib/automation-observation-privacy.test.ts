import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { isSensitiveObservation, observationValueHash } from '@/lib/automation/observation-privacy';
import { discoverFields } from '@/lib/automation/discovery';
afterEach(() => vi.unstubAllEnvs());
it('excludes personal/contact fields and embedded credentials from diagnostic discovery', () => {
  expect(
    discoverFields({
      customer_email: 'person@example.com',
      phoneNumber: '+1 (555) 123-4567',
      account: 'person@example.com',
      credential: 'innocuous',
      environment: 'production',
    })
  ).toEqual([expect.objectContaining({ key: 'environment', value: 'production' })]);
  expect(
    isSensitiveObservation({ key: 'label', path: 'payload.label', value: 'Bearer credential' })
  ).toBe(true);
});
it('keeps IPs, dates, epochs and numeric ids visible but still hides phone numbers by shape', () => {
  const sensitive = (value: string) =>
    isSensitiveObservation({ key: 'label', path: 'payload.label', value });
  for (const value of [
    '10.0.0.12',
    '192.168.100.200',
    '1700000000',
    '2026-11-18',
    '18-11-2026',
    '123456789012',
  ])
    expect(sensitive(value), value).toBe(false);
  for (const value of [
    '+15551234567',
    '+44 20 7946 0958',
    '(555) 123-4567',
    '555-123-4567',
    '555 123 4567',
    '555.123.4567',
  ])
    expect(sensitive(value), value).toBe(true);
});
it('uses service-scoped keyed value identities and disables discovery hashing without a secret', () => {
  vi.stubEnv('API_KEY_SECRET', 'observation-test-key-independent-secret');
  const first = observationValueHash('service-a', 'production');
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).toBe(observationValueHash('service-a', 'production'));
  expect(first).not.toBe(observationValueHash('service-b', 'production'));
  expect(first).not.toBe(createHash('sha256').update('production').digest('hex'));
  vi.stubEnv('API_KEY_SECRET', 'different-observation-key-independent-secret');
  expect(first).not.toBe(observationValueHash('service-a', 'production'));
  vi.stubEnv('API_KEY_SECRET', '');
  vi.stubEnv('NEXTAUTH_SECRET', '');
  expect(observationValueHash('service-a', 'production')).toBeNull();
});
