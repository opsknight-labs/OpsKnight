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
  it('commits an encrypted user intent and endpoint with a newly invited user in the caller transaction', async () => {
    let userId = '';
    const queued = await testPrisma.$transaction(
      async tx => {
        const user = await tx.user.create({
          data: {
            name: 'Transactional invitation',
            email: 'transactional-invite@example.invalid',
            status: 'INVITED',
          },
        });
        userId = user.id;
        return createCentralNotificationIntent(
          {
            category: 'ADMINISTRATION',
            channel: 'EMAIL',
            recipientType: 'USER',
            recipientId: user.id,
            recipientAddress: user.email,
            userId: user.id,
            templateKey: 'user-invitation',
            sourceType: 'USER_INVITATION',
            sourceId: user.id,
            eventKey: 'generation-1',
            displayMessage: 'Workspace invitation',
            payload: {
              kind: 'EMAIL',
              to: user.email,
              subject: 'Workspace invitation',
              html: '<a href="https://example.invalid/set-password#token=private-invite-capability">Accept</a>',
            },
          },
          tx
        );
      },
      { timeout: 10000 }
    );
    expect(queued).toMatchObject({ created: true });
    expect(await testPrisma.userNotificationEndpoint.count({ where: { userId } })).toBe(1);
    const row = await testPrisma.notification.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row).toMatchObject({ userId, status: 'PENDING' });
    expect(row.payloadEncrypted).not.toContain('private-invite-capability');
    expect(row.message).not.toContain('private-invite-capability');
  });

  it('rolls back a new user, encrypted notification and endpoint together after an outer failure', async () => {
    await expect(
      testPrisma.$transaction(
        async tx => {
          const user = await tx.user.create({
            data: {
              name: 'Rolled back invitation',
              email: 'rollback-invite@example.invalid',
              status: 'INVITED',
            },
          });
          await createCentralNotificationIntent(
            {
              category: 'ADMINISTRATION',
              channel: 'EMAIL',
              recipientType: 'USER',
              recipientId: user.id,
              recipientAddress: user.email,
              userId: user.id,
              templateKey: 'user-invitation',
              sourceType: 'USER_INVITATION',
              sourceId: user.id,
              eventKey: 'generation-1',
              displayMessage: 'Workspace invitation',
              payload: {
                kind: 'EMAIL',
                to: user.email,
                subject: 'Workspace invitation',
                text: 'Private invitation payload',
              html: '<p>Private invitation payload</p>',
              },
            },
            tx
          );
          throw new Error('Invitation receipt failed');
        },
        { timeout: 10000 }
      )
    ).rejects.toThrow('Invitation receipt failed');
    expect(await testPrisma.user.count()).toBe(0);
    expect(await testPrisma.userNotificationEndpoint.count()).toBe(0);
    expect(await testPrisma.notification.count()).toBe(0);
  });
});
