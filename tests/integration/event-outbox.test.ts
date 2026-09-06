import { beforeEach, describe, expect, it } from 'vitest';
import { processEvent, type EventPayload } from '@/lib/events';
import { claimPendingJobs } from '@/lib/jobs/queue';
import { resetDatabase, createTestService, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

type SideEffectPayload = {
  task?: string;
  effect?: string;
  lane?: string;
  incidentId?: string;
  eventOrderAt?: string;
};

describeIfRealDB('Event Transactional Outbox', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('commits trigger side-effects as durable jobs with the incident', async () => {
    const service = await createTestService('Outbox Trigger Service');
    const payload: EventPayload = {
      event_action: 'trigger',
      dedup_key: `outbox-trigger-${Date.now()}`,
      payload: {
        summary: 'Outbox trigger incident',
        source: 'outbox-test',
        severity: 'critical',
      },
    };

    const result = await processEvent(payload, service.id, 'outbox-integration');
    expect(result.action).toBe('triggered');

    const jobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'SCHEDULED_TASK' },
      orderBy: { createdAt: 'asc' },
    });

    expect(jobs).toHaveLength(5);
    expect(jobs.every(job => job.status === 'PENDING')).toBe(true);
    expect(jobs.every(job => job.maxAttempts === 5)).toBe(true);
    expect(jobs.map(job => (job.payload as SideEffectPayload).effect).sort()).toEqual(
      [
        'TRIGGER_ESCALATION_NOTIFICATIONS',
        'TRIGGER_SERVICE_NOTIFICATION',
        'TRIGGER_STATUS_PAGE',
        'TRIGGER_WAR_ROOM',
        'TRIGGER_WEBHOOK',
      ].sort()
    );
    expect(
      jobs.every(job => (job.payload as SideEffectPayload).incidentId === result.incident?.id)
    ).toBe(true);
    expect(jobs.every(job => Boolean((job.payload as SideEffectPayload).lane))).toBe(true);
    expect(jobs.every(job => Boolean((job.payload as SideEffectPayload).eventOrderAt))).toBe(true);
  });

  it('does not enqueue duplicate side-effects for a deduplicated trigger', async () => {
    const service = await createTestService('Outbox Dedup Service');
    const payload: EventPayload = {
      event_action: 'trigger',
      dedup_key: `outbox-dedup-${Date.now()}`,
      payload: {
        summary: 'Repeated trigger',
        source: 'outbox-test',
        severity: 'error',
      },
    };

    const first = await processEvent(payload, service.id, 'outbox-integration');
    const second = await processEvent(payload, service.id, 'outbox-integration');

    expect(first.action).toBe('triggered');
    expect(second.action).toBe('deduplicated');
    expect(await testPrisma.backgroundJob.count({ where: { type: 'SCHEDULED_TASK' } })).toBe(5);
  });

  it('enqueues action-specific jobs for acknowledge and resolve', async () => {
    const service = await createTestService('Outbox Lifecycle Service');
    const dedupKey = `outbox-lifecycle-${Date.now()}`;
    const basePayload = {
      dedup_key: dedupKey,
      payload: {
        summary: 'Outbox lifecycle incident',
        source: 'outbox-test',
        severity: 'warning' as const,
      },
    };

    const triggered = await processEvent(
      { ...basePayload, event_action: 'trigger' },
      service.id,
      'outbox-integration'
    );
    expect(triggered.action).toBe('triggered');

    const acknowledged = await processEvent(
      { ...basePayload, event_action: 'acknowledge' },
      service.id,
      'outbox-integration'
    );
    expect(acknowledged.action).toBe('acknowledged');

    const resolved = await processEvent(
      { ...basePayload, event_action: 'resolve' },
      service.id,
      'outbox-integration'
    );
    expect(resolved.action).toBe('resolved');

    const jobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'SCHEDULED_TASK' },
    });
    const effects = jobs.map(job => (job.payload as SideEffectPayload).effect);

    expect(jobs).toHaveLength(15);
    for (const effect of [
      'LIFECYCLE_USER_NOTIFICATION',
      'LIFECYCLE_SERVICE_NOTIFICATION',
      'LIFECYCLE_STATUS_PAGE',
      'LIFECYCLE_WEBHOOK',
    ]) {
      expect(effects.filter(candidate => candidate === effect)).toHaveLength(2);
    }
    expect(effects.filter(effect => effect === 'LIFECYCLE_WAR_ROOM_SYNC')).toHaveLength(1);
    expect(effects.filter(effect => effect === 'LIFECYCLE_WAR_ROOM_ARCHIVE')).toHaveLength(1);
  });

  it('claims later lifecycle work only after older jobs in the same lane complete', async () => {
    const service = await createTestService('Outbox Ordering Service');
    const dedupKey = `outbox-ordering-${Date.now()}`;
    const basePayload = {
      dedup_key: dedupKey,
      payload: {
        summary: 'Ordered lifecycle incident',
        source: 'outbox-test',
        severity: 'critical' as const,
      },
    };

    expect(
      (
        await processEvent(
          { ...basePayload, event_action: 'trigger' },
          service.id,
          'outbox-integration'
        )
      ).action
    ).toBe('triggered');
    expect(
      (
        await processEvent(
          { ...basePayload, event_action: 'resolve' },
          service.id,
          'outbox-integration'
        )
      ).action
    ).toBe('resolved');

    const firstClaim = await claimPendingJobs(20, 'SCHEDULED_TASK');
    const firstEffects = firstClaim.map(job => (job.payload as SideEffectPayload).effect);

    expect(firstEffects).toContain('TRIGGER_WEBHOOK');
    expect(firstEffects).toContain('TRIGGER_WAR_ROOM');
    expect(firstEffects).toContain('TRIGGER_ESCALATION_NOTIFICATIONS');
    expect(firstEffects).toContain('TRIGGER_SERVICE_NOTIFICATION');
    expect(firstEffects).toContain('TRIGGER_STATUS_PAGE');
    expect(firstEffects).not.toContain('LIFECYCLE_USER_NOTIFICATION');
    expect(firstEffects).not.toContain('LIFECYCLE_SERVICE_NOTIFICATION');
    expect(firstEffects).not.toContain('LIFECYCLE_STATUS_PAGE');
    expect(firstEffects).not.toContain('LIFECYCLE_WEBHOOK');
    expect(firstEffects).not.toContain('LIFECYCLE_WAR_ROOM_ARCHIVE');

    const completedLaneJobs = firstClaim.map(job => job.id);

    await testPrisma.backgroundJob.updateMany({
      where: { id: { in: completedLaneJobs } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const secondClaim = await claimPendingJobs(20, 'SCHEDULED_TASK');
    const secondEffects = secondClaim.map(job => (job.payload as SideEffectPayload).effect);
    expect(secondEffects.sort()).toEqual(
      [
        'LIFECYCLE_USER_NOTIFICATION',
        'LIFECYCLE_SERVICE_NOTIFICATION',
        'LIFECYCLE_STATUS_PAGE',
        'LIFECYCLE_WEBHOOK',
        'LIFECYCLE_WAR_ROOM_ARCHIVE',
      ].sort()
    );
  });

  it('does not leave outbox jobs when event transaction fails', async () => {
    const payload: EventPayload = {
      event_action: 'trigger',
      dedup_key: `outbox-rollback-${Date.now()}`,
      payload: {
        summary: 'Should roll back',
        source: 'outbox-test',
        severity: 'critical',
      },
    };

    await expect(processEvent(payload, 'missing-service', 'outbox-integration')).rejects.toThrow(
      /Service not found/
    );
    expect(await testPrisma.backgroundJob.count({ where: { type: 'SCHEDULED_TASK' } })).toBe(0);
  });
});
