import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, count, create } = vi.hoisted(() => ({
  transaction: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
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

function bootstrapForm(password = 'a secure admin passphrase', confirmPassword = password) {
  const form = new FormData();
  form.set('name', 'First Admin');
  form.set('email', 'admin@example.com');
  form.set('password', password);
  form.set('confirmPassword', confirmPassword);
  return form;
}

describe('bootstrap administrator security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    transaction.mockImplementation(async (callback, options) => {
      expect(options).toEqual({ isolationLevel: 'Serializable' });
      return callback({
        user: { count, create },
      });
    });
  });

  it('creates the administrator account on initial setup', async () => {
    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toEqual({ success: true, email: 'admin@example.com' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'First Admin',
          email: 'admin@example.com',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
      })
    );
  });

  it('rejects setup when passwords do not match', async () => {
    const result = await bootstrapAdmin(
      bootstrapForm('passphrase-one-valid', 'passphrase-two-diff')
    );
    expect(result).toEqual({ error: 'Passwords do not match.' });
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
      })
    );
    const result = await bootstrapAdmin(bootstrapForm());
    expect(result).toMatchObject({ success: true });
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
