import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prepareReceiptInsert } from '@/lib/ingestion/receipt-insert';
import { encodeEnvelope } from '@/lib/ingestion/contract';
import { isExplicitTransactionRetry } from '@/lib/transaction-retry';

function fixture() {
  const receivedAt = new Date();
  const envelope = encodeEnvelope({
    serviceId: 'service-a',
    integrationId: 'integration-a',
    integrationType: 'WEBHOOK',
    receivedAt,
    providerPayload: {},
    event: {
      event_action: 'trigger',
      dedup_key: 'fixture',
      payload: {
        summary: 'Fixture',
        source: 'fixture',
        severity: 'critical',
      },
    },
  });
  return prepareReceiptInsert([
    {
      id: 'receipt-a',
      receivedAt,
      serviceId: 'service-a',
      integrationId: 'integration-a',
      partitionKey: 'partition-a',
      orderingKeys: ['identity-a'],
      idempotencyKey: 'delivery-a',
      contentHash: 'hash-a',
      payloadBytes: 100,
      critical: true,
      envelope,
    },
  ]);
}

describe('prepared receipt insert failure contracts', () => {
  it('does not insert when no capacity was reserved', async () => {
    const execute = vi.fn();
    await fixture()({ $executeRaw: execute } as unknown as Prisma.TransactionClient, [undefined]);
    expect(execute).not.toHaveBeenCalled();
  });
  it('fails closed on a reservation cardinality mismatch', async () => {
    const execute = vi.fn();
    await expect(
      fixture()({ $executeRaw: execute } as unknown as Prisma.TransactionClient, [])
    ).rejects.toThrow('Receipt reservation mismatch');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['23505', '23503'])(
    'preserves unique-race retry without retrying foreign-key failures: %s',
    async code => {
      const error = new Prisma.PrismaClientKnownRequestError('constraint failure', {
        code: 'P2010',
        clientVersion: '5.22.0',
        meta: { code },
      });
      const tx = {
        $executeRaw: vi.fn().mockRejectedValue(error),
      } as unknown as Prisma.TransactionClient;
      await expect(fixture()(tx, [0])).rejects.toBe(error);
      expect(isExplicitTransactionRetry(error)).toBe(code === '23505');
    }
  );
  it('rejects an incomplete insert so its caller rolls back the reservation', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(0) } as unknown as Prisma.TransactionClient;
    await expect(fixture()(tx, [0])).rejects.toThrow(
      'Receipt insertion did not match reservations'
    );
  });
});
