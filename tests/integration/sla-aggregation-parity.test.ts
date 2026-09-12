import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { calculateSLAMetrics, checkIncidentSLA } from '@/lib/sla-server';
import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import { resolveNewIncidentSlaContract } from '@/lib/incident-sla/contract';
import { generateDailyRollup, queryRollupMetrics } from '@/lib/metric-rollup';
import { clearRetentionPolicyCache } from '@/lib/retention-policy';
import { applyIncidentCreation } from '@/lib/incidents/creation';
import { resolveIncidentClassification } from '@/lib/incidents/classification';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('SLA aggregation threshold parity', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
    clearRetentionPolicyCache();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('returns identical pause-aware MTTA below and above the SQL threshold', async () => {
    const service = await testPrisma.service.create({
      data: { name: `SLA parity ${crypto.randomUUID()}` },
    });
    const createdAt = new Date(Date.now() - 60 * 60_000);
    const acknowledgedAt = new Date(createdAt.getTime() + 30 * 60_000);
    const pauseStartedAt = new Date(createdAt.getTime() + 5 * 60_000);
    const pauseEndedAt = new Date(createdAt.getTime() + 15 * 60_000);

    const insertIncidents = async (start: number, count: number) => {
      const ids = Array.from(
        { length: count },
        (_, offset) => `sla-parity-${start + offset}-${crypto.randomUUID()}`
      );
      await testPrisma.incident.createMany({
        data: ids.map(id => ({
          id,
          title: 'SLA aggregation parity',
          serviceId: service.id,
          status: 'ACKNOWLEDGED',
          priority: 'P2',
          createdAt,
          acknowledgedAt,
          slaAckElapsedMs: BigInt(20 * 60_000),
        })),
      });
      await testPrisma.incidentSlaPause.createMany({
        data: ids.flatMap(incidentId => [
          { incidentId, startedAt: pauseStartedAt, endedAt: pauseEndedAt },
          // Deliberately overlaps the first interval. Both TS and SQL must
          // subtract the interval union (10 minutes), not the row sum (15).
          {
            incidentId,
            startedAt: new Date(createdAt.getTime() + 7 * 60_000),
            endedAt: new Date(createdAt.getTime() + 12 * 60_000),
          },
        ]),
      });
    };

    await insertIncidents(0, 499);
    const filters = {
      serviceId: service.id,
      startDate: new Date(createdAt.getTime() - 1),
      endDate: new Date(),
      userTimeZone: 'UTC',
      _forceLive: true,
    } as const;
    const belowThreshold = await calculateSLAMetrics(filters);

    await insertIncidents(499, 2);
    const aboveThreshold = await calculateSLAMetrics(filters);

    expect(belowThreshold.totalIncidents).toBe(499);
    expect(aboveThreshold.totalIncidents).toBe(501);
    expect(belowThreshold.mttd).toBeCloseTo(20, 8);
    expect(aboveThreshold.mttd).toBeCloseTo(belowThreshold.mttd ?? 0, 8);
    expect(aboveThreshold.ackRate).toBe(belowThreshold.ackRate);
  });

  it('keeps resolved-without-ACK compliance identical across projector, live, compatibility, and rollup engines', async () => {
    const service = await testPrisma.service.create({
      data: { name: `SLA semantic parity ${crypto.randomUUID()}` },
    });
    const createdAt = new Date();
    createdAt.setUTCDate(createdAt.getUTCDate() - 1);
    createdAt.setUTCHours(12, 0, 0, 0);
    const resolvedAt = new Date(createdAt.getTime() + 60_000);
    const incident = await testPrisma.incident.create({
      data: {
        title: 'Resolved without acknowledgement',
        serviceId: service.id,
        status: 'RESOLVED',
        createdAt,
        resolvedAt,
      },
    });
    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    const projected = projectIncidentSlaState(stored, { now: resolvedAt });
    const live = await calculateSLAMetrics({
      serviceId: service.id,
      startDate: new Date(createdAt.getTime() - 1),
      endDate: new Date(resolvedAt.getTime() + 1),
      userTimeZone: 'UTC',
      _forceLive: true,
    });
    const compatible = await checkIncidentSLA(incident.id);

    await generateDailyRollup(createdAt, service.id);
    const historical = await queryRollupMetrics(createdAt, createdAt, {
      serviceId: service.id,
    });

    expect(projected.valid && projected.ack.status).toBe('BREACHED');
    expect(live.ackCompliance).toBe(0);
    expect(compatible.ackSLA.breached).toBe(true);
    expect(historical.ackCompliance).toBe(0);
  });

  it('keeps timely source recovery out of the ACK denominator across engines at the exact deadline', async () => {
    const service = await testPrisma.service.create({
      data: { name: `SLA source-recovery parity ${crypto.randomUUID()}` },
    });
    const createdAt = new Date();
    createdAt.setUTCDate(createdAt.getUTCDate() - 1);
    createdAt.setUTCHours(13, 0, 0, 0);
    const ackTargetMs = 10 * 60_000;
    const resolvedAt = new Date(createdAt.getTime() + ackTargetMs);
    const incident = await testPrisma.incident.create({
      data: {
        title: 'Source recovered at ACK boundary',
        serviceId: service.id,
        status: 'RESOLVED',
        createdAt,
        resolvedAt,
        resolutionKind: 'SOURCE_RECOVERY',
        slaAckTargetMs: ackTargetMs,
        slaResolveTargetMs: 60 * 60_000,
        slaTargetSource: 'TEST',
        slaTargetCapturedAt: createdAt,
      },
    });
    const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    const projected = projectIncidentSlaState(stored, { now: resolvedAt });
    const live = await calculateSLAMetrics({
      serviceId: service.id,
      startDate: new Date(createdAt.getTime() - 1),
      endDate: new Date(resolvedAt.getTime() + 1),
      userTimeZone: 'UTC',
      _forceLive: true,
    });
    const compatible = await checkIncidentSLA(incident.id);

    await generateDailyRollup(createdAt, service.id);
    const historical = await queryRollupMetrics(createdAt, createdAt, {
      serviceId: service.id,
    });

    expect(projected.valid && projected.ack.status).toBe('NOT_REQUIRED');
    expect(projected.valid && projected.ack.applicability).toBe('NOT_REQUIRED');
    expect(live.ackCompliance).toBeNull();
    expect(compatible.ackSLA).toMatchObject({ breached: false, applicability: 'NOT_REQUIRED' });
    expect(historical.ackCompliance).toBeNull();
  });

  it.each([
    ['P1', 5, 60, 2, 30],
    ['P2', 15, 240, 4, 45],
    ['P3', 30, 480, 6, 60],
    ['P4', 60, 1_440, 8, 90],
    ['P5', 120, 2_880, 10, 120],
  ] as const)(
    '%s resolves, classifies, freezes, projects, and aggregates consistently',
    async (
      priority,
      workspaceAckMinutes,
      workspaceResolveMinutes,
      serviceAckMinutes,
      serviceResolveMinutes
    ) => {
      const service = await testPrisma.service.create({
        data: { name: `Priority contract ${priority} ${crypto.randomUUID()}` },
      });
      const classificationDraft = await testPrisma.incidentClassificationPolicy.create({
        data: {
          scopeKey: 'workspace',
          version: 2,
          inheritWorkspace: false,
          derivePriorityFromUrgency: false,
          rules: {
            create: [
              {
                matchType: 'ALERT_SEVERITY',
                matchValue: 'critical',
                priority,
                urgency: 'HIGH',
                priorityMode: 'SET',
                urgencyMode: 'SET',
              },
            ],
          },
        },
      });
      await testPrisma.incidentClassificationPolicy.update({
        where: { id: classificationDraft.id },
        data: { sealedAt: new Date() },
      });

      const workspaceContract = await testPrisma.$transaction(tx =>
        resolveNewIncidentSlaContract(tx, { serviceId: service.id, priority, now: new Date() })
      );
      expect(workspaceContract).toMatchObject({
        source: 'WORKSPACE_PRIORITY_OVERRIDE',
        policyRule: priority,
        ackTargetMs: workspaceAckMinutes * 60_000,
        resolveTargetMs: workspaceResolveMinutes * 60_000,
      });

      const servicePolicy = await testPrisma.incidentSlaPolicy.create({
        data: {
          scopeKey: `service:${service.id}`,
          version: 1,
          inheritWorkspace: true,
          rules: {
            create: {
              priority,
              ackTargetMs: serviceAckMinutes * 60_000,
              resolveTargetMs: serviceResolveMinutes * 60_000,
            },
          },
        },
      });
      await testPrisma.incidentSlaPolicy.update({
        where: { id: servicePolicy.id },
        data: { sealedAt: new Date() },
      });

      const classification = await testPrisma.$transaction(tx =>
        resolveIncidentClassification(tx, {
          serviceId: service.id,
          alertSeverity: 'critical',
        })
      );
      expect(classification).toMatchObject({
        priority,
        prioritySource: 'CLASSIFICATION_RULE',
        policyId: classificationDraft.id,
      });

      const createdAt = new Date();
      createdAt.setUTCDate(createdAt.getUTCDate() - 1);
      createdAt.setUTCHours(14, 0, 0, 0);
      const creation = await testPrisma.$transaction(tx =>
        applyIncidentCreation(tx, {
          title: `${priority} immutable SLA contract`,
          serviceId: service.id,
          urgency: classification.urgency,
          priority: classification.priority,
          source: 'REST_API',
          now: createdAt,
        })
      );
      const acknowledgedAt = new Date(createdAt.getTime() + serviceAckMinutes * 30_000);
      const resolvedAt = new Date(createdAt.getTime() + serviceResolveMinutes * 30_000);
      await testPrisma.incident.update({
        where: { id: creation.id },
        data: {
          status: 'RESOLVED',
          createdAt,
          acknowledgedAt,
          resolvedAt,
          resolutionKind: 'MANUAL',
          slaAckElapsedMs: BigInt(acknowledgedAt.getTime() - createdAt.getTime()),
          slaResolveElapsedMs: BigInt(resolvedAt.getTime() - createdAt.getTime()),
        },
      });

      const replacement = await testPrisma.incidentSlaPolicy.create({
        data: {
          scopeKey: `service:${service.id}`,
          version: 2,
          inheritWorkspace: false,
          baseAckTargetMs: 23 * 60_000,
          baseResolveTargetMs: 230 * 60_000,
        },
      });
      await testPrisma.incidentSlaPolicy.update({
        where: { id: replacement.id },
        data: { sealedAt: new Date() },
      });

      const stored = await testPrisma.incident.findUniqueOrThrow({ where: { id: creation.id } });
      expect(stored).toMatchObject({
        priority,
        slaPriorityAtCapture: priority,
        slaPolicyId: servicePolicy.id,
        slaPolicyVersion: 1,
        slaPolicyRule: priority,
        slaAckTargetMs: serviceAckMinutes * 60_000,
        slaResolveTargetMs: serviceResolveMinutes * 60_000,
      });
      const projected = projectIncidentSlaState(stored, { now: resolvedAt });
      if (!projected.valid) throw new Error(projected.reason);
      expect(projected.ack.status).toBe('MET');
      expect(projected.resolve.status).toBe('MET');
      expect(projected.contract.priorityAtCapture).toBe(priority);

      const range = {
        serviceId: service.id,
        startDate: new Date(createdAt.getTime() - 1),
        endDate: new Date(resolvedAt.getTime() + 1),
        userTimeZone: 'UTC',
      } as const;
      const live = await calculateSLAMetrics({ ...range, _forceLive: true });
      await generateDailyRollup(createdAt, service.id);
      const historical = await queryRollupMetrics(createdAt, createdAt, {
        serviceId: service.id,
      });
      expect(live.ackCompliance).toBe(100);
      expect(live.resolveCompliance).toBe(100);
      expect(historical.ackCompliance).toBe(live.ackCompliance);
      expect(historical.resolveCompliance).toBe(live.resolveCompliance);
    }
  );
});
