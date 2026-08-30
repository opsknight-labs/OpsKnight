import { beforeEach, describe, expect, it } from 'vitest';
import { sendNotification } from '@/lib/notifications';
import { createTestService, createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('incident responder invariants', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createIncident() {
    const service = await createTestService(`Responder invariant ${Math.random()}`);
    return testPrisma.incident.create({
      data: {
        title: 'Responder invariant incident',
        serviceId: service.id,
        status: 'OPEN',
        urgency: 'HIGH',
      },
    });
  }

  it('rejects assigning an incident to an inactive user at the database boundary', async () => {
    const [incident, disabled] = await Promise.all([
      createIncident(),
      createTestUser({
        email: 'inactive-assignee@example.com',
        name: 'Inactive Assignee',
        status: 'DISABLED',
      }),
    ]);

    await expect(
      testPrisma.incident.update({
        where: { id: incident.id },
        data: { assigneeId: disabled.id },
      })
    ).rejects.toThrow();

    const stored = await testPrisma.incident.findUnique({ where: { id: incident.id } });
    expect(stored?.assigneeId).toBeNull();
  });

  it('rejects inactive watchers and invalid watcher roles', async () => {
    const [incident, active, invited] = await Promise.all([
      createIncident(),
      createTestUser({ email: 'active-watcher@example.com', name: 'Active Watcher' }),
      createTestUser({
        email: 'invited-watcher@example.com',
        name: 'Invited Watcher',
        status: 'INVITED',
      }),
    ]);

    await expect(
      testPrisma.incidentWatcher.create({
        data: { incidentId: incident.id, userId: invited.id, role: 'FOLLOWER' },
      })
    ).rejects.toThrow();

    await expect(
      testPrisma.incidentWatcher.create({
        data: { incidentId: incident.id, userId: active.id, role: 'ROOT' },
      })
    ).rejects.toThrow();
  });

  it('terminally skips external delivery to inactive recipients before provider dispatch', async () => {
    const [incident, disabled] = await Promise.all([
      createIncident(),
      createTestUser({
        email: 'disabled-notification@example.com',
        name: 'Disabled Notification Target',
        status: 'DISABLED',
      }),
    ]);

    const result = await sendNotification(
      incident.id,
      disabled.id,
      'EMAIL',
      'This must never reach an external provider.'
    );

    expect(result).toMatchObject({ success: false, skipped: true, terminal: true });
    expect(await testPrisma.notification.count({ where: { userId: disabled.id } })).toBe(0);
  });
});