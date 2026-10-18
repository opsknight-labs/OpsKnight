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
