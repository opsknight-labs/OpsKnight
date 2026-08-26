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

    expect(jobs).toHaveLength(3);
    expect(jobs.every(job => job.status === 'PENDING')).toBe(true);
    expect(jobs.every(job => job.maxAttempts === 5)).toBe(true);
    expect(jobs.map(job => (job.payload as SideEffectPayload).effect).sort()).toEqual(
      ['TRIGGER_ESCALATION_NOTIFICATIONS', 'TRIGGER_WAR_ROOM', 'TRIGGER_WEBHOOK'].sort()
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
    expect(await testPrisma.backgroundJob.count({ where: { type: 'SCHEDULED_TASK' } })).toBe(3);
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

    expect(jobs).toHaveLength(7);
    expect(effects.filter(effect => effect === 'ACK_SLACK')).toHaveLength(1);
    expect(effects.filter(effect => effect === 'RESOLVE_WEBHOOK')).toHaveLength(1);
    expect(effects.filter(effect => effect === 'RESOLVE_SLACK')).toHaveLength(1);
    expect(effects.filter(effect => effect === 'RESOLVE_WAR_ROOM_ARCHIVE')).toHaveLength(1);
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
    expect(firstEffects).toContain('RESOLVE_SLACK');
    expect(firstEffects).not.toContain('RESOLVE_WEBHOOK');
    expect(firstEffects).not.toContain('RESOLVE_WAR_ROOM_ARCHIVE');

    const completedLaneJobs = firstClaim
      .filter(job => {
        const effect = (job.payload as SideEffectPayload).effect;
        return effect === 'TRIGGER_WEBHOOK' || effect === 'TRIGGER_WAR_ROOM';
      })
      .map(job => job.id);

    await testPrisma.backgroundJob.updateMany({
      where: { id: { in: completedLaneJobs } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const secondClaim = await claimPendingJobs(20, 'SCHEDULED_TASK');
    const secondEffects = secondClaim.map(job => (job.payload as SideEffectPayload).effect);
    expect(secondEffects).toContain('RESOLVE_WEBHOOK');
    expect(secondEffects).toContain('RESOLVE_WAR_ROOM_ARCHIVE');
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
