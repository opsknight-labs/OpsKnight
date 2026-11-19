import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/events/route';
import { encrypt } from '@/lib/encryption';
import { integrationKeyFingerprint } from '@/lib/integrations/credentials';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

beforeAll(() => {
  process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function integration(legacyStoredKeyAccepted?: boolean) {
  const service = await createTestService('legacy-key');
  const plaintext = randomBytes(16).toString('hex');
  const row = await testPrisma.integration.create({
    data: {
      name: 'Events',
      serviceId: service.id,
      key: await encrypt(plaintext),
      keyFingerprint: integrationKeyFingerprint(plaintext),
      enabled: false, // authentication is all this test exercises
      ...(legacyStoredKeyAccepted === undefined ? {} : { legacyStoredKeyAccepted }),
    },
  });
  return { plaintext, stored: row.key };
}

const send = async (key: string) => {
  const res = await POST(
    new NextRequest('http://localhost/api/events', {
      method: 'POST',
      headers: { Authorization: `Token token=${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
  );
  return JSON.stringify(await res.json());
};

it('keeps the old UI-copied encrypted value working for pre-upgrade integrations', async () => {
  const { plaintext, stored } = await integration(true);
  expect(await send(stored)).toContain('INTEGRATION_DISABLED');
  expect(await send(plaintext)).toContain('INTEGRATION_DISABLED');
});

it('accepts only the plaintext key for integrations created after the upgrade', async () => {
  const { plaintext, stored } = await integration();
  expect(await send(plaintext)).toContain('INTEGRATION_DISABLED');
  expect(await send(stored)).toContain('INTEGRATION_KEY_INVALID');
});
