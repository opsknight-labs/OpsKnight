import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  replay: vi.fn(),
}));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: mocks.transaction }));
vi.mock('@/lib/prisma', () => ({
  default: { $transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock('@/lib/idempotency', () => ({
  executeIdempotentOperation: vi.fn(),
  readIdempotentOperationResult: mocks.replay,
}));

import { runV2IdempotentMutation } from '@/lib/api-v2/idempotency';

const request = () =>
  new NextRequest('http://local/api/v2/x', { method: 'PUT', headers: { 'idempotency-key': 'k1' } });
const stale = () => new AppError({ code: 'PRECONDITION_FAILED' });

describe('idempotent mutation racing its own first attempt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the first attempt’s receipt when the retry lost the race on If-Match', async () => {
    mocks.transaction.mockRejectedValue(stale());
    mocks.replay.mockResolvedValue({ value: { revision: 2 }, replayed: true });
    await expect(
      runV2IdempotentMutation(request(), 'key-1', 'PUT:/x', {}, vi.fn())
    ).resolves.toEqual({ value: { revision: 2 }, replayed: true });
  });

  it('keeps a real stale revision a 412 when no attempt with that key committed', async () => {
    mocks.transaction.mockRejectedValue(stale());
    mocks.replay.mockResolvedValue(null);
    await expect(
      runV2IdempotentMutation(request(), 'key-1', 'PUT:/x', {}, vi.fn())
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
