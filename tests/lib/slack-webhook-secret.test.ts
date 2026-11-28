import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  encrypt: vi.fn(async (value: string) => `v3:k1:${Buffer.from(value).toString('base64')}`),
}));

vi.mock('@/lib/prisma', () => ({
  default: { service: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/encryption', () => ({
  encrypt: mocks.encrypt,
  isEncryptedSecret: (value: string) => value.startsWith('v3:'),
  decryptStoredSecret: async (value: string) =>
    value.startsWith('v3:') ? Buffer.from(value.split(':')[2], 'base64').toString() : value,
}));

import {
  readSlackWebhookUrl,
  reencryptSlackWebhookUrls,
  SLACK_WEBHOOK_REENCRYPT_BATCH,
  SLACK_WEBHOOK_REENCRYPT_MAX_BATCHES,
  slackWebhookHandle,
  storeSlackWebhookUrl,
} from '@/lib/slack-webhook-secret';

const URL_A = 'https://hooks.slack.com/services/T000/B000/secretA';
const URL_B = 'https://hooks.slack.com/services/T000/B000/secretB';

describe('Slack webhook secret storage', () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.updateMany.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.encrypt.mockClear();
  });

  it('reads both the legacy plaintext and the encrypted form, and nothing for an empty value', async () => {
    expect(await readSlackWebhookUrl(URL_A)).toBe(URL_A);
    expect(await readSlackWebhookUrl(`  ${URL_A}  `)).toBe(URL_A);
    expect(await readSlackWebhookUrl(await storeSlackWebhookUrl(URL_A))).toBe(URL_A);
    expect(await readSlackWebhookUrl(null)).toBeUndefined();
    expect(await readSlackWebhookUrl('   ')).toBeUndefined();
  });

  it('encrypts on write, so the stored value is not the URL', async () => {
    const stored = await storeSlackWebhookUrl(URL_A);
    expect(stored).not.toContain('secretA');
    expect(stored.startsWith('v3:')).toBe(true);
  });

  it('gives queue rows a stable handle that does not reveal the URL', () => {
    const handle = slackWebhookHandle(URL_A);
    expect(handle).toMatch(/^slack-webhook:[0-9a-f]{16}$/);
    expect(handle).toBe(slackWebhookHandle(URL_A));
    expect(handle).not.toBe(slackWebhookHandle(URL_B));
    expect(handle).not.toContain('secret');
  });

  it('re-encrypts only the plaintext rows and applies each write only if the value is unchanged', async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 'svc-1', slackWebhookUrl: URL_A },
      { id: 'svc-2', slackWebhookUrl: 'v3:k1:already' },
      { id: 'svc-3', slackWebhookUrl: URL_B },
    ]);
    await expect(reencryptSlackWebhookUrls()).resolves.toBe(2);

    expect(mocks.encrypt).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    const call = mocks.updateMany.mock.calls[0][0] as {
      where: { id: string; slackWebhookUrl: string };
      data: { slackWebhookUrl: string };
    };
    expect(call.where).toEqual({ id: 'svc-1', slackWebhookUrl: URL_A });
    expect(call.data.slackWebhookUrl.startsWith('v3:')).toBe(true);
    const query = mocks.findMany.mock.calls[0][0] as { where: { slackWebhookUrl: object } };
    expect(query.where.slackWebhookUrl).toEqual({ contains: '://' });
  });

  it('does not count a row that changed under it and is idempotent when nothing is left', async () => {
    mocks.findMany.mockResolvedValueOnce([{ id: 'svc-1', slackWebhookUrl: URL_A }]);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reencryptSlackWebhookUrls()).resolves.toBe(0);

    mocks.findMany.mockResolvedValueOnce([]);
    await expect(reencryptSlackWebhookUrls()).resolves.toBe(0);
  });

  it('is bounded to 10 batches of 100 per run', async () => {
    let next = 0;
    mocks.findMany.mockImplementation(async () =>
      Array.from({ length: SLACK_WEBHOOK_REENCRYPT_BATCH }, () => ({
        id: `svc-${String(next++).padStart(6, '0')}`,
        slackWebhookUrl: URL_A,
      }))
    );
    const converted = await reencryptSlackWebhookUrls();
    expect(mocks.findMany).toHaveBeenCalledTimes(SLACK_WEBHOOK_REENCRYPT_MAX_BATCHES);
    expect(converted).toBe(SLACK_WEBHOOK_REENCRYPT_BATCH * SLACK_WEBHOOK_REENCRYPT_MAX_BATCHES);
  });
});
