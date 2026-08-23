import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, count, create } = vi.hoisted(() => ({
  transaction: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: transaction },
}));
vi.mock('@/lib/audit', () => ({
  getDefaultActorId: vi.fn().mockResolvedValue(null),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import { bootstrapAdmin } from '@/app/setup/actions';

function bootstrapForm() {
  const form = new FormData();
  form.set('name', 'First Admin');
  form.set('email', 'admin@example.com');
  return form;
}

describe('bootstrap administrator transaction safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  });

  it('uses serializable isolation and retries a write conflict', async () => {
    transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback, options) => {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        return callback({ user: { count, create } });
      });

    const result = await bootstrapAdmin(bootstrapForm());

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: true, email: 'admin@example.com' });
  });

  it('redirects when a serialized retry observes an existing user', async () => {
    count.mockResolvedValue(1);
    transaction.mockImplementation(async (callback, options) => {
      expect(options).toEqual({ isolationLevel: 'Serializable' });
      return callback({ user: { count, create } });
    });

    await expect(bootstrapAdmin(bootstrapForm())).rejects.toThrow('REDIRECT:/login');
    expect(create).not.toHaveBeenCalled();
  });
});
