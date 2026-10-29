import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import {
  enqueueMicrosoftTeamsDelivery,
  processMicrosoftTeamsOperation,
  type TeamsDeliveryEnqueueInput,
} from '@/lib/microsoft-teams/delivery';
import { enqueueAutomationNotification } from '@/lib/automation/jobs';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

async function fixture() {
  process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
  const service = await db.service.create({
    data: { name: 'Teams lifecycle', serviceNotificationChannels: [] },
  });
  const incident = await db.incident.create({
    data: { serviceId: service.id, title: 'Teams card' },
  });
  const destination = await db.microsoftTeamsDestination.create({
    data: { serviceId: service.id, tenantId: 'tenant', teamId: 'team', channelId: 'channel' },
  });
  const input = (origin: 'SERVICE' | 'AUTOMATION'): TeamsDeliveryEnqueueInput => ({
    incidentId: incident.id,
    destinationId: destination.id,
    origin,
    eventType: 'triggered',
    incidentUpdatedAt: incident.createdAt,
    escalationGeneration: 0,
  });
  return { service, incident, destination, input };
}

async function ledger(incidentId: string) {
  const [operations, jobs, notifications] = await Promise.all([
    db.externalOperation.findMany({ where: { incidentId, provider: 'MICROSOFT_TEAMS' } }),
    db.backgroundJob.count({ where: { type: 'EXTERNAL_OPERATION' } }),
    db.notification.findMany({ where: { incidentId, channel: 'MICROSOFT_TEAMS' } }),
  ]);
  return { operations, jobs, notifications };
}

describe('automation and service Teams delivery share one logical intent', () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 30_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  it.each([
    ['service first', ['SERVICE', 'AUTOMATION'] as const],
    ['automation first', ['AUTOMATION', 'SERVICE'] as const],
  ])('keeps one card and automation authorization when %s', async (_label, order) => {
    const { incident, input } = await fixture();
    const ids = [];
    for (const origin of order) ids.push(await enqueueMicrosoftTeamsDelivery(input(origin)));

    expect(new Set(ids).size).toBe(1);
    const { operations, jobs, notifications } = await ledger(incident.id);
    expect(operations).toHaveLength(1);
    expect(jobs).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(operations[0].requestPayload).toMatchObject({ origin: 'AUTOMATION' });
    expect(notifications[0].sourceType).toBe('AUTOMATION');
  });

  it.each(['COMPLETED', 'FAILED'] as const)(
    'does not resurrect a %s operation when automation enqueues the same intent',
    async status => {
      const { incident, input } = await fixture();
      const id = await enqueueMicrosoftTeamsDelivery(input('SERVICE'));
      await db.externalOperation.update({ where: { id }, data: { status } });

      expect(await enqueueMicrosoftTeamsDelivery(input('AUTOMATION'))).toBe(id);

      const { operations, jobs } = await ledger(incident.id);
      expect(operations).toHaveLength(1);
      expect(operations[0].status).toBe(status);
      expect(jobs).toBe(1);
    }
  );

  it('fails an automation Teams card visibly when the incident resolves before delivery', async () => {
    const { incident, input } = await fixture();
    const id = await enqueueMicrosoftTeamsDelivery(input('AUTOMATION'));
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    await processMicrosoftTeamsOperation(id);

    const operation = await db.externalOperation.findUniqueOrThrow({ where: { id } });
    expect(operation.status).toBe('FAILED');
    expect(operation.lastError).toContain('Incident is now RESOLVED');
    const { notifications } = await ledger(incident.id);
    expect(notifications[0].status).toBe('FAILED');
    expect(notifications[0].errorMsg).toContain('RESOLVED');
  });

  it('fails visibly when the destination is disabled after enqueue', async () => {
    const { incident, destination, input } = await fixture();
    const id = await enqueueMicrosoftTeamsDelivery(input('AUTOMATION'));
    await db.microsoftTeamsDestination.update({
      where: { id: destination.id },
      data: { enabled: false },
    });

    await expect(processMicrosoftTeamsOperation(id)).rejects.toThrow('not enabled');

    const operation = await db.externalOperation.findUniqueOrThrow({ where: { id } });
    expect(operation.status).toBe('FAILED');
    expect(operation.lastError).toBe('Teams destination is not enabled');
    const { notifications } = await ledger(incident.id);
    expect(notifications[0].status).toBe('FAILED');
  });

  it('skips enqueue, without creating intents, when the destination is disabled before the job runs', async () => {
    const { service, incident, destination } = await fixture();
    await db.microsoftTeamsDestination.update({
      where: { id: destination.id },
      data: { enabled: false },
    });

    await db.$transaction(tx =>
      enqueueAutomationNotification(tx, {
        task: 'AUTOMATION_NOTIFY',
        incidentId: incident.id,
        serviceId: service.id,
        versionId: 'version',
        type: 'NOTIFY_CHANNEL',
        ruleId: 'rule',
        logicalKey: 'disabled-destination',
        provider: 'TEAMS',
        destinationId: destination.id,
      })
    );

    const { operations, notifications } = await ledger(incident.id);
    expect(operations).toHaveLength(0);
    expect(notifications).toHaveLength(0);
  });
});
