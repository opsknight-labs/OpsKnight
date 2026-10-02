import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: { systemSettings: { findUnique: vi.fn(async () => null) } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { decrypt, encrypt, getEncryptionKeyringEntries } from '@/lib/encryption';

const OLD_KEY = '3c1f0e5a9b7d2c4e6f8a0b1c2d3e4f5061728394a5b6c7d8e9f0011223344556';
const NEW_KEY = '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba';
const OTHER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f8a9';
const ENV_KEYS = ['ENCRYPTION_KEY', 'ENCRYPTION_KEYS', 'NODE_ENV'] as const;

/** Byte-for-byte reproduction of the 1.4 `v2:` AES-256-CBC envelope writer. */
function encrypt14(text: string, keyHex: string) {
  const dek = crypto.randomBytes(32);
  const payloadIv = crypto.randomBytes(16);
  const payloadCipher = crypto.createCipheriv('aes-256-cbc', dek, payloadIv);
  let payload = payloadCipher.update(text, 'utf8', 'hex');
  payload += payloadCipher.final('hex');
  const dekIv = crypto.randomBytes(16);
  const dekCipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), dekIv);
  let encryptedDek = dekCipher.update(dek.toString('hex'), 'utf8', 'hex');
  encryptedDek += dekCipher.final('hex');
  return `v2:${dekIv.toString('hex')}:${encryptedDek}:${payloadIv.toString('hex')}:${payload}`;
}

function setKeys(env: { ENCRYPTION_KEY?: string; ENCRYPTION_KEYS?: string }) {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEYS;
  Object.assign(process.env, env);
}

describe('encryption keyring rotation across 1.x -> 2.0', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    (process.env as Record<string, string>).NODE_ENV = 'production';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else (process.env as Record<string, string>)[key] = saved[key]!;
    }
  });

  it('maps a single ENCRYPTION_KEY to k1 and writes v3:k1 ciphertext', async () => {
    setKeys({ ENCRYPTION_KEY: OLD_KEY });
    expect(getEncryptionKeyringEntries()).toEqual([{ id: 'k1', key: OLD_KEY }]);
    const ciphertext = await encrypt('webhook-secret');
    expect(ciphertext.startsWith('v3:k1:')).toBe(true);
    await expect(decrypt(ciphertext)).resolves.toBe('webhook-secret');
  });

  it.each([
    ['ENCRYPTION_KEYS only', { ENCRYPTION_KEYS: `k2:${NEW_KEY},k1:${OLD_KEY}` }],
    ['both during migration', { ENCRYPTION_KEY: OLD_KEY, ENCRYPTION_KEYS: `k2:${NEW_KEY},k1:${OLD_KEY}` }],
    ['new keyring plus legacy key', { ENCRYPTION_KEY: OLD_KEY, ENCRYPTION_KEYS: `k2:${NEW_KEY}` }],
  ])('reads 1.4 v2 and 2.0 v3:k1 data after rotating to k2 (%s)', async (_label, env) => {
    setKeys({ ENCRYPTION_KEY: OLD_KEY });
    const v3k1 = await encrypt('slack-bot-token');
    const v2Legacy = encrypt14('pagerduty-routing-key', OLD_KEY);

    setKeys(env);
    expect(getEncryptionKeyringEntries()[0]).toEqual({ id: 'k2', key: NEW_KEY });
    await expect(decrypt(v3k1)).resolves.toBe('slack-bot-token');
    await expect(decrypt(v2Legacy)).resolves.toBe('pagerduty-routing-key');

    const reencrypted = await encrypt(await decrypt(v2Legacy));
    expect(reencrypted.startsWith('v3:k2:')).toBe(true);
    await expect(decrypt(reencrypted)).resolves.toBe('pagerduty-routing-key');
  });

  it('still reads v3:k1 data when the historical key was re-labelled in the keyring', async () => {
    setKeys({ ENCRYPTION_KEY: OLD_KEY });
    const v3k1 = await encrypt('teams-client-secret');

    setKeys({ ENCRYPTION_KEYS: `k1:${OTHER_KEY},legacy:${OLD_KEY}` });
    await expect(decrypt(v3k1)).resolves.toBe('teams-client-secret');
  });

  it('upgrades a 1.x Compose install that used the public default key', async () => {
    const composeDefault = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const v2Legacy = encrypt14('smtp-password', composeDefault);

    setKeys({ ENCRYPTION_KEYS: `k2:${NEW_KEY},k1:${composeDefault}` });
    expect(getEncryptionKeyringEntries()[0]).toEqual({ id: 'k2', key: NEW_KEY });
    await expect(decrypt(v2Legacy)).resolves.toBe('smtp-password');
    expect((await encrypt('smtp-password')).startsWith('v3:k2:')).toBe(true);

    setKeys({ ENCRYPTION_KEYS: `k1:${composeDefault}` });
    expect(getEncryptionKeyringEntries()).toEqual([]);
  });

  it('fails closed when the historical key is no longer configured', async () => {
    setKeys({ ENCRYPTION_KEY: OLD_KEY });
    const v3k1 = await encrypt('email-password');

    setKeys({ ENCRYPTION_KEYS: `k2:${NEW_KEY}` });
    await expect(decrypt(v3k1)).rejects.toThrow('Failed to decrypt token');
  });
});
