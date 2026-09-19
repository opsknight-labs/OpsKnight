import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transaction,
  count,
  create,
  findUniqueConfig,
  updateConfig,
  findUniqueSettings,
  upsertSettings,
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  findUniqueConfig: vi.fn(),
  updateConfig: vi.fn(),
  findUniqueSettings: vi.fn(),
  upsertSettings: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { $transaction: transaction } }));
vi.mock('@/lib/audit', () => ({
  getDefaultActorId: vi.fn().mockResolvedValue(null),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  authPrivacyDigest: vi.fn().mockResolvedValue('a'.repeat(64)),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: vi.fn().mockReturnValue('127.0.0.1') }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import { bootstrapAdmin } from '@/app/setup/actions';
import { hashBootstrapCode } from '@/lib/bootstrap-security';

const bootstrapCode = 'bootstrap-code-that-is-long-enough';

function bootstrapForm(code = bootstrapCode) {
  const form = new FormData();
  form.set('name', 'First Admin');
  form.set('email', 'admin@example.com');
  form.set('bootstrapCode', code);
  form.set('password', 'a secure admin passphrase');
  form.set('confirmPassword', 'a secure admin passphrase');
  return form;
}

describe('bootstrap administrator security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    findUniqueConfig.mockResolvedValue({
      value: {
        tokenHash: hashBootstrapCode(bootstrapCode),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        usedAt: null,
        generation: 1,
      },
    });
    updateConfig.mockResolvedValue({});
    findUniqueSettings.mockResolvedValue(null);
    upsertSettings.mockResolvedValue({});
    transaction.mockImplementation(async (callback, options) => {
      expect(options).toEqual({ isolationLevel: 'Serializable' });
      return callback({
        user: { count, create },
        systemConfig: { findUnique: findUniqueConfig, update: updateConfig },
        systemSettings: { findUnique: findUniqueSettings, upsert: upsertSettings },
      });
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires and atomically consumes the one-time capability', async () => {
    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toEqual({ success: true, email: 'admin@example.com' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'auth.bootstrap.authorization' },
        data: expect.objectContaining({ updatedBy: 'admin-1' }),
      })
    );
  });

  it('rejects an invalid capability without creating an admin', async () => {
    const result = await bootstrapAdmin(bootstrapForm('wrong-code-that-is-long-enough'));
    expect(result).toEqual({ error: 'Invalid or expired setup authorization code.' });
    expect(create).not.toHaveBeenCalled();
  });

  it('redirects when an existing user is observed inside the serializable transaction', async () => {
    count.mockResolvedValue(1);
    await expect(bootstrapAdmin(bootstrapForm())).rejects.toThrow('REDIRECT:/login');
    expect(create).not.toHaveBeenCalled();
  });

  it('retries a serializable write conflict', async () => {
    transaction.mockRejectedValueOnce({ code: 'P2034' }).mockImplementationOnce(async callback =>
      callback({
        user: { count, create },
        systemConfig: { findUnique: findUniqueConfig, update: updateConfig },
        systemSettings: { findUnique: findUniqueSettings, upsert: upsertSettings },
      })
    );
    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toMatchObject({ success: true });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('seeds SystemSettings.appUrl when no canonical appUrl is preconfigured', async () => {
    findUniqueSettings.mockResolvedValue(null);
    const { headers } = await import('next/headers');
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({
        host: 'fresh.opsknight.test:3100',
        origin: 'http://fresh.opsknight.test:3100',
      })
    );

    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toEqual({ success: true, email: 'admin@example.com' });
    expect(upsertSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'default' },
        create: expect.objectContaining({ appUrl: 'http://fresh.opsknight.test:3100' }),
        update: expect.objectContaining({ appUrl: 'http://fresh.opsknight.test:3100' }),
      })
    );
  });

  it('does NOT overwrite existing configured SystemSettings.appUrl', async () => {
    findUniqueSettings.mockResolvedValue({ appUrl: 'https://canonical.company.com' });
    const { headers } = await import('next/headers');
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({
        host: 'temporary.company.com',
        origin: 'https://temporary.company.com',
      })
    );

    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toEqual({ success: true, email: 'admin@example.com' });
    expect(upsertSettings).not.toHaveBeenCalled();
  });

  it('does NOT overwrite when NEXT_PUBLIC_APP_URL is preconfigured in environment', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://env.company.com';
    findUniqueSettings.mockResolvedValue(null);
    const { headers } = await import('next/headers');
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({
        host: 'temporary.company.com',
        origin: 'https://temporary.company.com',
      })
    );

    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toEqual({ success: true, email: 'admin@example.com' });
    expect(upsertSettings).not.toHaveBeenCalled();
  });
});
