import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { processEvent, EventPayload } from '@/lib/events';
import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestService,
  createTestIncident,
  createTestNotificationProvider,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Event Ingestion Resilience Tests', { timeout: 30000 }, () => {
  beforeAll(async () => {
    await resetDatabase();
    // Ensure notification provider exists for the jobs triggered by processEvent
    await createTestNotificationProvider('resend', {
      apiKey: 'test-api-key',
      fromEmail: 'alerts@opsknight.com',
    });
  });

  beforeEach(async () => {
    await resetDatabase();
    // Re-create provider as resetDatabase clears everything
    await createTestNotificationProvider('resend', {
      apiKey: 'test-api-key',
      fromEmail: 'alerts@opsknight.com',
    });
  });

  describe('Incident Deduplication Race Conditions', () => {
    it('should create exactly one incident when receiving identical trigger events concurrently', async () => {
      const service = await createTestService('Deduplication Service');
      const dedupKey = `test-dedup-${Date.now()}`;
      const eventCount = 10;

      const payload: EventPayload = {
        event_action: 'trigger',
        dedup_key: dedupKey,
        payload: {
          summary: 'Critical System Failure',
          source: 'test-monitor',
          severity: 'critical',
        },
      };

      // This is intentionally true concurrency. Event ingestion uses
      // ReadCommitted isolation plus a transaction-scoped advisory lock for the
      // service/dedup key so unrelated keys can progress independently while
      // the find-then-create deduplication boundary remains race-safe.
      const results = await Promise.all(
        Array.from({ length: eventCount }, () =>
          processEvent(payload, service.id, 'test-integration-id')
        )
      );

      // Verify results
      const triggeredCount = results.filter(r => r.action === 'triggered').length;
      const deduplicatedCount = results.filter(r => r.action === 'deduplicated').length;

      expect(triggeredCount).toBe(1);
      expect(deduplicatedCount).toBe(eventCount - 1);

      // Verify DB state
      const scopedDedupKey = `test-integration-id:${dedupKey}`;
      const incidentCount = await testPrisma.incident.count({
        where: { dedupKey: scopedDedupKey, serviceId: service.id },
      });
      expect(incidentCount).toBe(1);

      // Verify all alerts are linked to the same incident
      const alerts = await testPrisma.alert.findMany({
        where: { dedupKey: scopedDedupKey, serviceId: service.id },
      });
      expect(alerts).toHaveLength(eventCount);

      const incident = await testPrisma.incident.findFirst({
        where: { dedupKey: scopedDedupKey, serviceId: service.id },
      });
      expect(alerts.every(a => a.incidentId === incident?.id)).toBe(true);
    });
  });

  describe('Auto-Resolution Resilience', () => {
    it('completes the published trigger, acknowledge, and resolve lifecycle', async () => {
      const service = await createTestService('Release Lifecycle Service');
      const dedupKey = `release-lifecycle-${Date.now()}`;
      const basePayload = {
        dedup_key: dedupKey,
        payload: {
          summary: 'Release contract incident',
          source: 'release-quality',
          severity: 'critical' as const,
        },
      };

      const triggered = await processEvent(
        { ...basePayload, event_action: 'trigger' },
        service.id,
        'release-quality'
      );
      expect(triggered.action).toBe('triggered');

      const acknowledged = await processEvent(
        { ...basePayload, event_action: 'acknowledge' },
        service.id,
        'release-quality'
      );
      expect(acknowledged.action).toBe('acknowledged');

      const resolved = await processEvent(
        { ...basePayload, event_action: 'resolve' },
        service.id,
        'release-quality'
      );
      expect(resolved.action).toBe('resolved');

      const incident = await testPrisma.incident.findFirst({
        where: { serviceId: service.id, dedupKey: `release-quality:${dedupKey}` },
      });
      expect(incident?.status).toBe('RESOLVED');
      expect(incident?.acknowledgedAt).not.toBeNull();
      expect(incident?.resolvedAt).not.toBeNull();

      const timeline = await testPrisma.incidentEvent.findMany({
        where: { incidentId: incident!.id },
      });
      expect(timeline.some(event => event.message.includes('Acknowledged via API event'))).toBe(
        true
      );
      expect(timeline.some(event => event.message.includes('Auto-resolved'))).toBe(true);
    });

    it('should resolve incident exactly once when receiving multiple resolve events', async () => {
      const service = await createTestService('Resolution Service');
      const dedupKey = `test-resolve-${Date.now()}`;

      // 1. Create the incident first
      await processEvent(
        {
          event_action: 'trigger',
          dedup_key: dedupKey,
          payload: { summary: 'Problem', source: 'test', severity: 'error' },
        },
        service.id,
        'test-id'
      );

      const incidentBefore = await testPrisma.incident.findFirst({
        where: { dedupKey: `test-id:${dedupKey}`, status: 'OPEN' },
      });
      expect(incidentBefore).not.toBeNull();

      // 2. Send rapid sequential resolve events
      const resolvePayload: EventPayload = {
        event_action: 'resolve',
        dedup_key: dedupKey,
        payload: { summary: 'Problem Solved', source: 'test', severity: 'info' },
      };

      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await processEvent(resolvePayload, service.id, 'test-id'));
      }

      // Verify actions
      const resolvedCount = results.filter(r => r.action === 'resolved').length;
      expect(resolvedCount).toBe(1);

      // Verify incident status
      const incidentAfter = await testPrisma.incident.findUnique({
        where: { id: incidentBefore!.id },
      });
      expect(incidentAfter?.status).toBe('RESOLVED');

      // Verify audit events - should have exactly one resolution event
      const events = await testPrisma.incidentEvent.findMany({
        where: { incidentId: incidentBefore!.id },
      });
      const resolveEvents = events.filter(e => e.message.includes('Auto-resolved'));
      expect(resolveEvents).toHaveLength(1);
    });
  });
});
