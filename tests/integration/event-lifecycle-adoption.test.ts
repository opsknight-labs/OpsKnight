import { beforeEach, describe, expect, it } from 'vitest';
import { processEvent, type EventPayload } from '@/lib/events';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

type SideEffectPayload = {
  effect?: string;
  incidentId?: string;
};

describeIfRealDB('Event lifecycle engine adoption', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('keeps repeated acknowledge alerts but emits lifecycle work only once', async () => {
    const service = await createTestService('Event Lifecycle Idempotency Service');
    const dedupKey = `event-lifecycle-ack-${Date.now()}`;
    const basePayload = {
      dedup_key: dedupKey,
      payload: {
        summary: 'Event lifecycle acknowledgement',
        source: 'event-lifecycle-test',
        severity: 'warning' as const,
      },
    };

    const triggered = await processEvent(
      { ...basePayload, event_action: 'trigger' },
      service.id,
      'event-lifecycle'
    );
    expect(triggered.action).toBe('triggered');

    const acknowledgePayload: EventPayload = {
      ...basePayload,
      event_action: 'acknowledge',
    };

    const first = await processEvent(acknowledgePayload, service.id, 'event-lifecycle');
    const second = await processEvent(acknowledgePayload, service.id, 'event-lifecycle');

    expect(first.action).toBe('acknowledged');
    expect(second.action).toBe('acknowledged');

    const incident = await testPrisma.incident.findFirst({
      where: { serviceId: service.id, dedupKey: `event-lifecycle:${dedupKey}` },
    });
    expect(incident?.status).toBe('ACKNOWLEDGED');
    expect(incident?.acknowledgedAt).not.toBeNull();

    // Raw ingestion remains lossless: trigger + both acknowledge signals are retained.
    const alerts = await testPrisma.alert.findMany({
      where: { incidentId: incident!.id },
    });
    expect(alerts).toHaveLength(3);

    // Lifecycle state/audit is idempotent even when the upstream provider retries.
    const acknowledgeEvents = await testPrisma.incidentEvent.findMany({
      where: { incidentId: incident!.id, type: 'ACKNOWLEDGED' },
    });
    expect(acknowledgeEvents).toHaveLength(1);
    expect(acknowledgeEvents[0]?.message).toBe('Acknowledged via API event.');

    const jobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'SCHEDULED_TASK' },
    });
    const acknowledgeJobs = jobs.filter(
      job =>
        (job.payload as SideEffectPayload).effect === 'ACK_SLACK' &&
        (job.payload as SideEffectPayload).incidentId === incident!.id
    );
    expect(acknowledgeJobs).toHaveLength(1);
  });
});
