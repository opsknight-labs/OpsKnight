import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encrypt } from '@/lib/encryption';
import { integrationKeyFingerprint } from '@/lib/integrations/credentials';

const db = vi.hoisted(() => ({ integration: { findFirst: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ default: db }));

const plaintext = 'routing-key-plaintext-0123456789abcdef';
let stored: string;

const post = async (key: string) => {
  const { POST } = await import('@/app/api/events/route');
  const res = await POST(
    new NextRequest('http://localhost/api/events', {
      method: 'POST',
      headers: { Authorization: `Token token=${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
  );
  return (await res.json()) as { error?: { code?: string }; code?: string };
};
const code = (body: { error?: { code?: string }; code?: string }) =>
  body.error?.code ?? body.code ?? JSON.stringify(body);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  stored = await encrypt(plaintext);
});

beforeEach(() => {
  db.integration.findFirst.mockReset();
});

describe('/api/events routing-key authentication', () => {
  it('finds encrypted keys by fingerprint and accepts the plaintext key', async () => {
    db.integration.findFirst.mockResolvedValue({
      id: 'i1',
      type: 'EVENTS_API_V2',
      enabled: false, // stop right after authentication
      key: stored,
      previousKey: null,
      previousKeyExpiresAt: null,
    });
    expect(code(await post(plaintext))).toContain('INTEGRATION_DISABLED');
    const where = db.integration.findFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ keyFingerprint: integrationKeyFingerprint(plaintext) });
  });

  it('rejects the stored ciphertext presented as a key', async () => {
    db.integration.findFirst.mockResolvedValue({
      id: 'i1',
      type: 'EVENTS_API_V2',
      enabled: true,
      key: stored,
      previousKey: null,
      previousKeyExpiresAt: null,
    });
    expect(code(await post(stored))).toContain('INTEGRATION_KEY_INVALID');
  });

  it('accepts the previous key during the rotation overlap window', async () => {
    db.integration.findFirst.mockResolvedValue({
      id: 'i1',
      type: 'EVENTS_API_V2',
      enabled: false,
      key: await encrypt('new-key'),
      previousKey: stored,
      previousKeyExpiresAt: new Date(Date.now() + 60_000),
    });
    expect(code(await post(plaintext))).toContain('INTEGRATION_DISABLED');
  });

  it('rejects unknown keys', async () => {
    db.integration.findFirst.mockResolvedValue(null);
    expect(code(await post('nope'))).toContain('INTEGRATION_KEY_INVALID');
  });
});
