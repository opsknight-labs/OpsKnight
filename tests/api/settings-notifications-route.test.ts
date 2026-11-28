/* eslint-disable @typescript-eslint/no-explicit-any -- partial prisma mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = { provider: string; enabled: boolean; config: Record<string, unknown> };
const store = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn().mockResolvedValue({ id: 'admin-1' }) }));
vi.mock('@/lib/notification-providers', () => ({ invalidateNotificationProviderCache: vi.fn() }));
vi.mock('@/lib/encrypted-provider-config', () => ({
  SECRET_MASK: '********',
  decryptProviderConfig: async (_provider: string, config: Record<string, unknown>) => ({
    ...config,
  }),
  encryptProviderConfig: async (_provider: string, config: Record<string, unknown>) => ({
    ...config,
  }),
  mergeSensitiveProviderFields: (
    _provider: string,
    next: Record<string, unknown>,
    existing: Record<string, unknown>
  ) => ({
    ...next,
    // An empty secret in the body means "keep what is stored".
    authToken: next.authToken === '' ? existing.authToken : next.authToken,
  }),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    notificationProvider: {
      findUnique: async ({ where }: { where: { provider: string } }) =>
        store.rows.get(where.provider) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const row = store.rows.get(where.provider);
        const next = { provider: where.provider, ...(row ? update : create) } as Row;
        store.rows.set(where.provider, next);
        return next;
      },
      update: async ({ where, data }: any) => {
        const row = store.rows.get(where.provider)!;
        const next = { ...row, ...data } as Row;
        store.rows.set(where.provider, next);
        return next;
      },
      create: async ({ data }: any) => {
        store.rows.set(data.provider, data as Row);
        return data;
      },
    },
  },
}));

import { POST } from '@/app/api/settings/notifications/route';

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/settings/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  store.rows.clear();
  store.rows.set('twilio', {
    provider: 'twilio',
    enabled: true,
    config: {
      enabled: true,
      accountSid: 'AC-old',
      authToken: 'token-old',
      fromNumber: '+100',
      voiceEnabled: true,
      whatsappNumber: '+200',
    },
  });
});

describe('POST /api/settings/notifications', () => {
  it('keeps settings the body does not carry, such as voiceEnabled, when SMS settings change', async () => {
    const res = await post({
      sms: { provider: 'twilio', enabled: true, accountSid: 'AC-new', authToken: 'token-new' },
    });
    expect(res.status).toBe(200);
    expect(store.rows.get('twilio')!.config).toMatchObject({
      accountSid: 'AC-new',
      authToken: 'token-new',
      voiceEnabled: true,
    });
  });

  it('does not revert the SMS credentials when the same body also carries WhatsApp settings', async () => {
    const res = await post({
      sms: { provider: 'twilio', enabled: true, accountSid: 'AC-new', authToken: 'token-new' },
      whatsapp: { number: '+300' },
    });
    expect(res.status).toBe(200);
    expect(store.rows.get('twilio')!.config).toMatchObject({
      accountSid: 'AC-new',
      authToken: 'token-new',
      voiceEnabled: true,
      whatsappNumber: '+300',
    });
  });
});
