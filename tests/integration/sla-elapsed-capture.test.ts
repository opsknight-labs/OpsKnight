import { beforeEach, describe, expect, it } from 'vitest';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';
import { executeIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { readFileSync } from 'node:fs';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('materialized SLA lifecycle elapsed values', { timeout: 30_000 }, () => {
  beforeEach(() => resetDatabase());

  it('persists pause-adjusted ACK and keeps it immutable after later pauses', async () => {
    const service = await createTestService('SLA capture');
    const now = new Date('2026-09-06T12:00:00Z');
    const incident = await testPrisma.incident.create({
      data: {
        title: 'SLA capture ACK',
        serviceId: service.id,
        urgency: 'HIGH',
        createdAt: new Date(now.getTime() - 20 * 60_000),
        slaPausedMs: BigInt(5 * 60_000),
      },
    });
    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'ACKNOWLEDGE',
      source: 'WEB',
      now,
    });
    await testPrisma.incident.update({
      where: { id: incident.id },
      data: { slaPausedMs: { increment: BigInt(10 * 60_000) } },
    });
    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(stored.slaAckElapsedMs).toBe(BigInt(15 * 60_000));
  });

  it('preserves lifetime first-ACK truth through reopen, re-ack, and final resolve', async () => {
    const service = await createTestService('SLA reopen lifetime');
    const createdAt = new Date('2026-09-06T10:00:00Z');
    const firstAckAt = new Date('2026-09-06T10:05:00Z');
    const firstResolveAt = new Date('2026-09-06T10:30:00Z');
    const reopenAt = new Date('2026-09-06T20:00:00Z');
    const secondAckAt = new Date('2026-09-06T20:05:00Z');
    const finalResolveAt = new Date('2026-09-06T20:30:00Z');
    const incident = await testPrisma.incident.create({
      data: { title: 'Reopened incident', serviceId: service.id, urgency: 'HIGH', createdAt },
    });

    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'ACKNOWLEDGE',
      source: 'WEB',
      now: firstAckAt,
    });
    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'RESOLVE',
      source: 'WEB',
      now: firstResolveAt,
    });
    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'REOPEN',
      source: 'WEB',
      now: reopenAt,
    });

    const reopened = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(reopened.acknowledgedAt).toBeNull();
    expect(reopened.slaFirstAcknowledgedAt).toEqual(firstAckAt);
    expect(reopened.slaAckElapsedMs).toBe(BigInt(5 * 60_000));
    expect(reopened.slaResolveElapsedMs).toBeNull();

    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'ACKNOWLEDGE',
      source: 'WEB',
      now: secondAckAt,
    });
    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'RESOLVE',
      source: 'WEB',
      now: finalResolveAt,
    });

    const final = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(final.slaAckElapsedMs).toBe(BigInt(5 * 60_000));
    expect(final.slaFirstAcknowledgedAt).toEqual(firstAckAt);
    expect(final.slaResolveElapsedMs).toBe(BigInt(finalResolveAt.getTime() - createdAt.getTime()));
  });

  it('preserves first-ACK truth when an old writer tries to clear it', async () => {
    const service = await createTestService('Immutable first ACK');
    const incident = await testPrisma.incident.create({
      data: {
        title: 'Immutable ACK capture',
        serviceId: service.id,
        urgency: 'HIGH',
        acknowledgedAt: new Date('2026-09-06T10:05:00Z'),
        slaFirstAcknowledgedAt: new Date('2026-09-06T10:05:00Z'),
        slaAckElapsedMs: BigInt(5 * 60_000),
      },
    });

    await testPrisma.incident.update({
      where: { id: incident.id },
      data: { acknowledgedAt: null, slaFirstAcknowledgedAt: null, slaAckElapsedMs: null },
    });

    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(stored.acknowledgedAt).toBeNull();
    expect(stored.slaFirstAcknowledgedAt).toEqual(new Date('2026-09-06T10:05:00Z'));
    expect(stored.slaAckElapsedMs).toBe(BigInt(5 * 60_000));
    await expect(
      testPrisma.incidentSlaLegacyAckMutation.aggregate({ _sum: { count: true } })
    ).resolves.toMatchObject({ _sum: { count: BigInt(1) } });
  });

  it('repairs ACK facts erased by pre-upgrade reopen from the earliest durable event', async () => {
    const service = await createTestService('Legacy erased first ACK');
    const createdAt = new Date('2026-09-06T10:00:00Z');
    const firstAckAt = new Date('2026-09-06T10:05:00Z');
    const incident = await testPrisma.incident.create({
      data: {
        title: 'Legacy reopened incident',
        serviceId: service.id,
        urgency: 'HIGH',
        createdAt,
        acknowledgedAt: null,
        slaFirstAcknowledgedAt: null,
        slaAckElapsedMs: null,
      },
    });
    await testPrisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: 'ACKNOWLEDGED',
        message: 'Incident acknowledged',
        createdAt: firstAckAt,
      },
    });
    await testPrisma.incidentSlaPause.create({
      data: {
        incidentId: incident.id,
        startedAt: new Date('2026-09-06T10:01:00Z'),
        endedAt: new Date('2026-09-06T10:03:00Z'),
      },
    });

    const migration = readFileSync(
      'prisma/migrations/20260920000003_incident_first_ack_compatibility/migration.sql',
      'utf8'
    );
    const repair = migration.slice(
      migration.indexOf('WITH first_ack_events AS'),
      migration.indexOf('-- END legacy first-ACK repair')
    );
    await testPrisma.$executeRawUnsafe(repair);

    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(stored.acknowledgedAt).toBeNull();
    expect(stored.slaFirstAcknowledgedAt).toEqual(firstAckAt);
    expect(stored.slaAckElapsedMs).toBe(BigInt(3 * 60_000));
  });

  it('subtracts an open pause when resolve commits', async () => {
    const service = await createTestService('SLA capture resolve');
    const now = new Date('2026-09-06T12:00:00Z');
    const incident = await testPrisma.incident.create({
      data: {
        title: 'SLA capture resolve',
        serviceId: service.id,
        urgency: 'HIGH',
        createdAt: new Date(now.getTime() - 60 * 60_000),
        slaPausedMs: BigInt(10 * 60_000),
        slaPauseStartedAt: new Date(now.getTime() - 10 * 60_000),
        status: 'SNOOZED',
        escalationStatus: 'PAUSED',
      },
    });
    await testPrisma.incidentSlaPause.create({
      data: { incidentId: incident.id, startedAt: new Date(now.getTime() - 10 * 60_000) },
    });
    await executeIncidentLifecycleCommand({
      incidentId: incident.id,
      command: 'RESOLVE',
      source: 'WEB',
      now,
    });
    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(stored.slaResolveElapsedMs).toBe(BigInt(40 * 60_000));
  });

  it('backfills legacy resolved rows that only have updatedAt', async () => {
    const service = await createTestService('Legacy resolve capture');
    const createdAt = new Date('2026-09-06T10:00:00Z');
    const updatedAt = new Date('2026-09-06T11:00:00Z');
    const incident = await testPrisma.incident.create({
      data: {
        title: 'Legacy resolved incident',
        serviceId: service.id,
        urgency: 'HIGH',
        status: 'RESOLVED',
        createdAt,
        updatedAt,
        resolvedAt: null,
        slaResolveElapsedMs: null,
      },
    });
    await testPrisma.incidentSlaPause.create({
      data: {
        incidentId: incident.id,
        startedAt: new Date('2026-09-06T10:10:00Z'),
        endedAt: new Date('2026-09-06T10:20:00Z'),
      },
    });
    const migration = readFileSync(
      'prisma/migrations/20260906170000_capture_incident_sla_elapsed/migration.sql',
      'utf8'
    );
    const backfill = migration.slice(migration.indexOf('WITH targets AS'));
    await testPrisma.$executeRawUnsafe(backfill);
    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(stored.slaResolveElapsedMs).toBe(BigInt(50 * 60_000));
  });
});
