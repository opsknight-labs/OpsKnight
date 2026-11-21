import { beforeEach, describe, expect, it } from 'vitest';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import { executeIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { BUNDLE_WINDOW_MS } from '@/lib/notification-noise-controller';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

function page(
  userId: string,
  incidentId: string,
  overrides: Partial<Parameters<typeof createCentralNotificationIntent>[0]> = {}
) {
  return {
    category: 'INCIDENT' as const,
    channel: 'SMS' as const,
    recipientType: 'USER' as const,
    recipientId: userId,
    recipientAddress: '+15550000001',
    userId,
    incidentId,
    templateKey: 'incident-triggered',
    sourceType: 'INCIDENT',
    sourceId: incidentId,
    eventKey: `${incidentId}:step-0`,
    displayMessage: 'Incident notification',
    trafficClass: 'CRITICAL' as const,
    priority: 1,
    ...overrides,
    payload: {
      kind: `INCIDENT_${overrides.channel ?? 'SMS'}`,
      userId,
      incidentId,
      eventType: 'triggered',
      eventAt: new Date().toISOString(),
      durableMessage: 'Incident notification',
    } as never,
  };
}

describeIfRealDB('notification acknowledgement capture and bundling', { timeout: 30_000 }, () => {
  let userId: string;
  let serviceId: string;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    await resetDatabase();
    userId = (await createTestUser()).id;
    serviceId = (await createTestService('payments')).id;
  });

  async function incident(title: string) {
    return (await createTestIncident(title, serviceId, { urgency: 'LOW' })).id;
  }

  it('stores the escalation step on the page', async () => {
    const created = await createCentralNotificationIntent(
      page(userId, await incident('one'), { escalationStepIndex: 2 })
    );
    const row = await testPrisma.notification.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.escalationStepIndex).toBe(2);
    expect(row.ackedAt).toBeNull();
  });

  it('sends every page at once while the recipient has not opted in', async () => {
    for (const title of ['one', 'two', 'three']) {
      await createCentralNotificationIntent(page(userId, await incident(title)));
    }
    const rows = await testPrisma.notification.findMany();
    expect(rows.map(row => row.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(rows.every(row => row.scheduledAt.getTime() <= Date.now())).toBe(true);
  });

  it('bundles low-urgency pages: first at once, second held, third behind the held one', async () => {
    const ids: string[] = [];
    for (const title of ['one', 'two', 'three']) {
      const created = await createCentralNotificationIntent(
        page(userId, await incident(title), { bundle: true })
      );
      ids.push(created.id);
    }
    const [first, second, third] = await Promise.all(
      ids.map(id => testPrisma.notification.findUniqueOrThrow({ where: { id } }))
    );

    expect(first.status).toBe('PENDING');
    expect(first.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now());

    expect(second.status).toBe('PENDING');
    expect(second.scheduledAt.getTime()).toBeGreaterThan(Date.now() + BUNDLE_WINDOW_MS - 30_000);
    expect(second.nextAttemptAt).toEqual(second.scheduledAt);
    expect(second.message).toContain('Bundled low-urgency pages');

    expect(third.status).toBe('SKIPPED');
    expect(third.errorMsg).toBe('Bundled with other low-urgency pages');
  });

  it('never bundles a high-urgency page, and bundles per channel', async () => {
    await createCentralNotificationIntent(page(userId, await incident('one'), { bundle: true }));
    const urgent = await createCentralNotificationIntent(
      page(userId, await incident('urgent'), { bundle: true, priority: 0 })
    );
    const otherChannel = await createCentralNotificationIntent(
      page(userId, await incident('push'), {
        bundle: true,
        channel: 'PUSH',
        recipientAddress: userId,
      })
    );
    for (const id of [urgent.id, otherChannel.id]) {
      const row = await testPrisma.notification.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('PENDING');
      expect(row.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it('stamps only the page the acknowledgement arrived through', async () => {
    const incidentId = await incident('acked');
    const other = await createTestUser({ email: 'other@example.com' });
    const mine = await createCentralNotificationIntent(page(userId, incidentId));
    const theirs = await createCentralNotificationIntent(
      page(other.id, incidentId, { recipientAddress: '+15550000002' })
    );

    // A caller cannot stamp somebody else's page.
    await executeIncidentLifecycleCommand({
      incidentId,
      command: 'ACKNOWLEDGE',
      source: 'VOICE',
      actor: { id: userId },
      ackedNotification: { id: theirs.id, via: 'VOICE', userId },
    });
    expect(
      await testPrisma.notification.count({ where: { incidentId, ackedAt: { not: null } } })
    ).toBe(0);

    await executeIncidentLifecycleCommand({ incidentId, command: 'UNACKNOWLEDGE', source: 'WEB' });
    await executeIncidentLifecycleCommand({
      incidentId,
      command: 'ACKNOWLEDGE',
      source: 'VOICE',
      actor: { id: userId },
      ackedNotification: { id: mine.id, via: 'VOICE', userId },
    });
    const rows = await testPrisma.notification.findMany({
      where: { incidentId },
      select: { id: true, ackedAt: true, ackedVia: true },
    });
    expect(rows.find(row => row.id === mine.id)).toMatchObject({ ackedVia: 'VOICE' });
    expect(rows.find(row => row.id === mine.id)?.ackedAt).toBeInstanceOf(Date);
    expect(rows.find(row => row.id === theirs.id)).toMatchObject({ ackedAt: null, ackedVia: null });
  });
});
