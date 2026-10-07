import { describe, expect, it, vi, beforeEach } from 'vitest';

const transaction = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: { $transaction: transaction } }));

import { isRetryableTransactionError, runSerializableTransaction } from '@/lib/db-utils';

describe('transaction retry helpers', () => {
  beforeEach(() => {
    transaction.mockReset();
  });

  it('retries structural Prisma write-conflict errors from a generated client', async () => {
    transaction
      .mockRejectedValueOnce({ code: 'P2034', message: 'Transaction failed due to a write conflict.' })
      .mockImplementationOnce(async (operation: (tx: object) => Promise<string>) => operation({}));

    await expect(runSerializableTransaction(async () => 'committed', 2)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries P2010 raw query errors when nested DB meta code is 40001 (serialization failure)', async () => {
    transaction
      .mockRejectedValueOnce({
        code: 'P2010',
        meta: { code: '40001', message: 'could not serialize access due to concurrent update' },
        message: 'Raw query failed. Code: 40001. Message: could not serialize access due to concurrent update',
      })
      .mockImplementationOnce(async (operation: (tx: object) => Promise<string>) => operation({}));

    await expect(runSerializableTransaction(async () => 'committed', 2)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries P2010 raw query errors when nested DB meta code is 40P01 (deadlock detected)', async () => {
    transaction
      .mockRejectedValueOnce({
        code: 'P2010',
        meta: { code: '40P01', message: 'deadlock detected' },
        message: 'Raw query failed. Code: 40P01.',
      })
      .mockImplementationOnce(async (operation: (tx: object) => Promise<string>) => operation({}));

    await expect(runSerializableTransaction(async () => 'committed', 2)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries P2010 raw query errors when message contains concurrent update / serialize', async () => {
    transaction
      .mockRejectedValueOnce({
        code: 'P2010',
        message: 'Raw query failed. could not serialize access due to concurrent update',
      })
      .mockImplementationOnce(async (operation: (tx: object) => Promise<string>) => operation({}));

    await expect(runSerializableTransaction(async () => 'committed', 2)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry P2010 raw query errors with non-retryable SQLSTATE (e.g. 42P01 syntax/missing table)', async () => {
    transaction.mockRejectedValueOnce({
      code: 'P2010',
      meta: { code: '42P01', message: 'relation does not exist' },
      message: 'Raw query failed. Code: 42P01. Message: relation "DoesNotExist" does not exist',
    });

    await expect(runSerializableTransaction(async () => 'committed', 2)).rejects.toMatchObject({
      code: 'P2010',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  describe('isRetryableTransactionError classifier', () => {
    it('classifies 40001 and 40P01 as retryable', () => {
      expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
      expect(isRetryableTransactionError({ code: '40P01' })).toBe(true);
    });

    it('classifies Prisma codes P2034, P2002, P2028 as retryable', () => {
      expect(isRetryableTransactionError({ code: 'P2034' })).toBe(true);
      expect(isRetryableTransactionError({ code: 'P2002' })).toBe(true);
      expect(isRetryableTransactionError({ code: 'P2028' })).toBe(true);
    });

    it('classifies nested meta.code 40001 and 40P01 inside P2010 as retryable', () => {
      expect(isRetryableTransactionError({ code: 'P2010', meta: { code: '40001' } })).toBe(true);
      expect(isRetryableTransactionError({ code: 'P2010', meta: { code: '40P01' } })).toBe(true);
    });

    it('classifies message containing serialization or deadlock as retryable', () => {
      expect(
        isRetryableTransactionError(new Error('could not serialize access due to concurrent update'))
      ).toBe(true);
      expect(isRetryableTransactionError(new Error('deadlock detected'))).toBe(true);
      expect(isRetryableTransactionError(new Error('write conflict'))).toBe(true);
    });

    it('classifies non-retryable codes as false', () => {
      expect(isRetryableTransactionError({ code: 'P2025' })).toBe(false);
      expect(isRetryableTransactionError({ code: 'P2010', meta: { code: '42P01' } })).toBe(false);
      expect(isRetryableTransactionError(new Error('validation failed'))).toBe(false);
      expect(isRetryableTransactionError(null)).toBe(false);
      expect(isRetryableTransactionError(undefined)).toBe(false);
    });
  });
});
