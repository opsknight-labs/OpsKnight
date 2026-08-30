import { beforeEach, describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/events';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('event deduplication semantics', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('raises deduplicated incident urgency monotonically and never lowers it', async () => {
    const service = await createTestService('Event Dedup Urgency Service');
    const dedupKey = `event-dedup-urgency-${Date.now()}`;
    const basePayload = {
      dedup_key: dedupKey,
      payload: {
        summary: 'Database latency',
        source: 'event-dedup-test',
      },
    };

    await processEvent(
      {
        ...basePayload,
        event_action: 'trigger',
        payload: { ...basePayload.payload, severity: 'warning' as const },
      },
      service.id,
      'event-dedup'
    );

    await processEvent(
      {
        ...basePayload,
        event_action: 'trigger',
        payload: { ...basePayload.payload, severity: 'critical' as const },
      },
      service.id,
      'event-dedup'
    );

    let incident = await testPrisma.incident.findFirst({
      where: { serviceId: service.id, dedupKey: `event-dedup:${dedupKey}` },
    });
    expect(incident?.urgency).toBe('HIGH');

    await processEvent(
      {
        ...basePayload,
        event_action: 'trigger',
        payload: { ...basePayload.payload, severity: 'info' as const },
      },
      service.id,
      'event-dedup'
    );

    incident = await testPrisma.incident.findUnique({ where: { id: incident!.id } });
    expect(incident?.urgency).toBe('HIGH');

    const escalationEvent = await testPrisma.incidentEvent.findFirst({
      where: { incidentId: incident!.id, message: { contains: 'Urgency raised to HIGH' } },
    });
    expect(escalationEvent).not.toBeNull();
  });

  it('stores canonical incident text instead of HTML entities', async () => {
    const service = await createTestService('Event Canonical Text Service');
    const dedupKey = `event-canonical-text-${Date.now()}`;
    const summary = 'Database <primary> & "replica"';

    await processEvent(
      {
        event_action: 'trigger',
        dedup_key: dedupKey,
        payload: {
          summary,
          source: 'monitor <prod>',
          severity: 'critical',
        },
      },
      service.id,
      'event-canonical'
    );

    const incident = await testPrisma.incident.findFirst({
      where: { serviceId: service.id, dedupKey: `event-canonical:${dedupKey}` },
    });
    expect(incident?.title).toBe(summary);
    expect(incident?.title).not.toContain('&lt;');

    const event = await testPrisma.incidentEvent.findFirst({
      where: { incidentId: incident!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(event?.message).toContain('monitor <prod>');
  });
});