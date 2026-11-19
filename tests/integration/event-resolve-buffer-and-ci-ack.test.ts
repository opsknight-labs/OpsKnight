import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

function ingest(
  serviceId: string,
  integrationType: string,
  action: EventPayload['event_action'],
  dedupKey: string
) {
  const event: EventPayload = {
    event_action: action,
    dedup_key: dedupKey,
    payload: { summary: 'Check failed', source: 'test', severity: 'critical' },
  };
  return processIntegrationEvent({
    serviceId,
    integrationId: `int-${integrationType.toLowerCase()}`,
    integrationType,
    event,
    providerPayload: event,
    receivedAt: new Date(),
  });
}

describeIfRealDB('out-of-order resolve buffer and CI acknowledge', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('still pre-resolves a genuine out-of-order monitor resolve', async () => {
    const service = await createTestService('Buffer genuine');
    await ingest(service.id, 'NAGIOS', 'resolve', 'k1');
    const result = await ingest(service.id, 'NAGIOS', 'trigger', 'k1');
    expect(result.action).toBe('resolved');
  });

  it('does not pre-resolve the next outage after a manual resolve', async () => {
    const service = await createTestService('Buffer manual');
    await ingest(service.id, 'UPTIMEROBOT', 'trigger', 'k2');
    await testPrisma.incident.updateMany({
      where: { serviceId: service.id },
      // Closed by hand well before the buffer window, while the site still flaps.
      data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    // The provider's late UP belongs to the episode that was closed by hand.
    await ingest(service.id, 'UPTIMEROBOT', 'resolve', 'k2');
    const result = await ingest(service.id, 'UPTIMEROBOT', 'trigger', 'k2');
    expect(result.action).toBe('triggered');
  });

  it('never buffers a CI success, so the next failure pages', async () => {
    const service = await createTestService('Buffer CI');
    await ingest(service.id, 'VERCEL', 'resolve', 'k3');
    const result = await ingest(service.id, 'VERCEL', 'trigger', 'k3');
    expect(result.action).toBe('triggered');
  });

  it('CI informational acknowledge leaves an open failure unacknowledged', async () => {
    const service = await createTestService('CI ack');
    await ingest(service.id, 'GITHUB', 'trigger', 'k4');
    const ack = await ingest(service.id, 'GITHUB', 'acknowledge', 'k4');
    expect(ack.action).toBe('ignored');
    const incident = await testPrisma.incident.findFirstOrThrow({
      where: { serviceId: service.id },
    });
    expect(incident.status).toBe('OPEN');

    // Non-CI acknowledgements still acknowledge.
    await ingest(service.id, 'NAGIOS', 'trigger', 'k5');
    expect((await ingest(service.id, 'NAGIOS', 'acknowledge', 'k5')).action).toBe('acknowledged');
  });
});
