import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCentralNotificationIntent,
  requeueCentralNotification,
} from '@/lib/notification-control-plane';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('notification control-plane database guarantees', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    await resetDatabase();
  });

  it('materializes exactly one intent under concurrent producer retries', async () => {
    const input = {
      category: 'SECURITY' as const,
      channel: 'EMAIL' as const,
      recipientType: 'EMAIL' as const,
      recipientAddress: 'recipient@example.com',
      templateKey: 'security-alert',
      sourceType: 'SECURITY_EVENT',
      sourceId: 'event-1',
      eventKey: 'generation-1',
      displayMessage: 'Security alert',
      payload: {
        kind: 'EMAIL' as const,
        to: 'recipient@example.com',
        subject: 'Security alert',
        html: '<p>secret body</p>',
      },
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => createCentralNotificationIntent(input))
    );

    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    const rows = await testPrisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipientDisplay).toBe('r***@example.com');
    expect(rows[0]?.payloadEncrypted).not.toContain('recipient@example.com');
    expect(rows[0]?.payloadEncrypted).not.toContain('secret body');
  });

  it('allows only one administrator to requeue the same failed generation', async () => {
    const created = await createCentralNotificationIntent({
      category: 'SYSTEM',
      channel: 'PUSH',
      recipientType: 'USER',
      recipientId: 'user-1',
      recipientAddress: 'user-1',
      templateKey: 'system-alert',
      sourceType: 'SYSTEM',
      sourceId: 'system-1',
      eventKey: 'generation-1',
      displayMessage: 'System alert',
      payload: { kind: 'PUSH', userId: 'user-1', title: 'Alert', body: 'Body' },
    });
    await testPrisma.notification.update({
      where: { id: created.id },
      data: { status: 'FAILED', attempts: 3, maxAttempts: 3 },
    });

    const results = await Promise.all([
      requeueCentralNotification(created.id),
      requeueCentralNotification(created.id),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(
      testPrisma.notification.findUniqueOrThrow({ where: { id: created.id } })
    ).resolves.toMatchObject({ status: 'PENDING', attempts: 3, maxAttempts: 4 });
  });
});
