import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { observeSmtpDelivery } = require('../../scripts/ingestion/smtp-capture.cjs');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  const notification = {
    deliveryProvider: 'smtp',
    providerMessageId: '<owned-message@example.test>',
  };
  const receipt = { status: 'COMPLETED', result: { incidentId: 'owned-incident' } };
  const captured = {
    To: [{ Address: 'owned@example.test' }],
    Subject: 'Critical owned-subject',
    MessageID: 'owned-message@example.test',
  };
  const prisma = {
    ingestionReceipt: { findUniqueOrThrow: vi.fn().mockResolvedValue(receipt) },
    notification: { findFirst: vi.fn().mockResolvedValue(notification) },
  };
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [captured] }),
  });
  vi.stubGlobal('fetch', fetch);
  return {
    prisma,
    notification,
    receipt,
    captured,
    fetch,
    options: {
      prisma,
      receiptId: 'owned-receipt',
      recipient: 'owned@example.test',
      userId: 'owned-user',
      subjectToken: 'owned-subject',
      captureUrl: 'http://127.0.0.1:8025',
      timeoutMs: 1000,
    },
  };
}

describe('owned SMTP capture reconciliation', () => {
  it('requires matching captured mail and durable SMTP delivery for the receipt recipient', async () => {
    const f = fixture();
    await expect(observeSmtpDelivery(f.options)).resolves.toMatchObject({
      captured: f.captured,
      receipt: f.receipt,
      notification: f.notification,
    });
    expect(f.prisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        incidentId: 'owned-incident',
        userId: 'owned-user',
        channel: 'EMAIL',
        status: { in: ['SENT', 'DELIVERED'] },
      },
    });
  });

  it('rejects mail whose provider identity differs from the durable record', async () => {
    const f = fixture();
    f.captured.MessageID = 'other-message@example.test';
    await expect(observeSmtpDelivery(f.options)).rejects.toThrow('persisted provider delivery ID');
  });

  it('fails immediately when processing dead-letters the paging fixture', async () => {
    const f = fixture();
    f.receipt.status = 'DEAD';
    await expect(observeSmtpDelivery(f.options)).rejects.toThrow('dead-lettered');
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('does not count capture API failures as successful SMTP delivery', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue({ ok: false });
    await expect(observeSmtpDelivery(f.options)).rejects.toThrow('capture API unavailable');
  });

  it('fails boundedly when captured mail has no successful durable notification', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.prisma.notification.findFirst.mockResolvedValue(null);
    const result = expect(observeSmtpDelivery(f.options)).rejects.toThrow(
      'successful durable delivery record'
    );
    await vi.advanceTimersByTimeAsync(1100);
    await result;
  });

  it('ignores messages addressed to another user or with another subject', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.captured.To = [{ Address: 'other@example.test' }];
    const result = expect(observeSmtpDelivery(f.options)).rejects.toThrow(
      'did not reach the owned SMTP capture server'
    );
    await vi.advanceTimersByTimeAsync(1100);
    await result;
  });
});
