import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { generateDailyRollup } from '@/lib/metric-rollup';
import { clearRetentionPolicyCache } from '@/lib/retention-policy';

afterAll(() => prisma.$disconnect());

it(
  'pages incident history and preserves lifetime event/incidence and frozen SLA aggregates',
  { timeout: 60000 },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toMatch(/^\/ingestion_test_/);
    const service = await prisma.service.create({
      data: { name: `Owned paged rollup ${randomUUID()}` },
    });
    const prefix = randomUUID();
    const count = 2505;
    const ids = Array.from({ length: count }, (_, i) => `${prefix}-${String(i).padStart(5, '0')}`);
    const at = new Date(Date.now() - 2 * 86400000);
    at.setUTCHours(9, 0, 0, 0);
    let active = false,
      incidentSelects = 0,
      unboundedSelects = 0,
      maxParameters = 0;
    prisma.$on('query', event => {
      if (!active) return;
      if (
        event.query.includes('FROM "public"."Incident"') &&
        event.query.trimStart().startsWith('SELECT')
      ) {
        incidentSelects++;
        if (!event.query.includes('LIMIT')) unboundedSelects++;
      }
      const values: unknown = JSON.parse(event.params);
      if (Array.isArray(values)) maxParameters = Math.max(maxParameters, values.length);
    });
    try {
      clearRetentionPolicyCache();
      for (let offset = 0; offset < count; offset += 500) {
        await prisma.incident.createMany({
          data: ids.slice(offset, offset + 500).map((id, j) => ({
            id,
            serviceId: service.id,
            title: 'Owned paged metric fixture',
            status: 'RESOLVED' as const,
            urgency: 'HIGH' as const,
            priority: (offset + j) % 2 ? 'P2' : 'P1',
            createdAt: at,
            acknowledgedAt: new Date(at.getTime() + 600000),
            resolvedAt: new Date(at.getTime() + 1800000),
            resolutionKind: 'MANUAL' as const,
            slaAckElapsedMs: BigInt(600000),
            slaResolveElapsedMs: BigInt(1800000),
            slaAckTargetMs: 900000,
            slaResolveTargetMs: 3600000,
            slaTargetSource: 'TEST',
            slaTargetCapturedAt: at,
          })),
        });
        await prisma.alert.createMany({
          data: ids
            .slice(offset, offset + 500)
            .map(incidentId => ({ incidentId, serviceId: service.id, createdAt: at, payload: {} })),
        });
      }
      await prisma.incidentEvent.createMany({
        data: [
          { incidentId: ids[0], type: 'ESCALATED', message: 'Typed escalation' },
          { incidentId: ids[0], type: 'ESCALATED', message: 'Second escalation' },
          {
            incidentId: ids[1000],
            message: 'escalated to historical owner',
            createdAt: new Date(at.getTime() + 86400000),
          },
          { incidentId: ids[0], type: 'ACKNOWLEDGED', message: 'Quoted escalated to text' },
          { incidentId: ids[2000], type: 'REOPENED', message: 'Typed reopen' },
          { incidentId: ids[2000], message: 'legacy reopen' },
          { incidentId: ids[0], message: 'do not reopen' },
          { incidentId: ids[0], type: 'AUTO_RESOLVED', message: 'Typed recovery' },
          { incidentId: ids[2000], message: 'auto-resolved by source' },
          { incidentId: ids[1000], message: 'not auto-resolved' },
        ],
      });
      active = true;
      await generateDailyRollup(at, service.id);
      active = false;
      const row = await prisma.incidentMetricRollup.findFirstOrThrow({
        where: { serviceId: service.id },
      });
      expect(incidentSelects).toBeGreaterThanOrEqual(3);
      expect(unboundedSelects).toBe(0);
      expect(maxParameters).toBeLessThanOrEqual(1100);
      expect(row).toMatchObject({
        totalIncidents: count,
        resolvedIncidents: count,
        alertCount: count,
        mttaCount: count,
        mttrCount: count,
        ackSlaMet: count,
        resolveSlaMet: count,
        escalationEventCount: 3,
        escalatedIncidentCount: 2,
        escalationCount: 3,
        reopenEventCount: 2,
        reopenedIncidentCount: 1,
        reopenCount: 2,
        autoResolveEventCount: 2,
        autoResolvedIncidentCount: 2,
        autoResolveCount: 2,
      });
      expect(row.mttaSum).toBe(BigInt(count) * BigInt(600000));
      expect(row.mttrSum).toBe(BigInt(count) * BigInt(1800000));
      const priorities = await prisma.incidentMetricRollupByPriority.findMany({
        where: { rollupId: row.id },
      });
      expect(priorities.find(p => p.priority === 'P1')?.incidents).toBe(1253);
      expect(priorities.find(p => p.priority === 'P2')?.incidents).toBe(1252);
    } finally {
      active = false;
      const rows = await prisma.incidentMetricRollup.findMany({
        where: { serviceId: service.id },
        select: { id: true },
      });
      await prisma.incidentMetricRollupByPriority.deleteMany({
        where: { rollupId: { in: rows.map(row => row.id) } },
      });
      await prisma.incidentMetricRollup.deleteMany({ where: { serviceId: service.id } });
      await prisma.incidentEvent.deleteMany({ where: { incident: { serviceId: service.id } } });
      await prisma.incidentSlaPause.deleteMany({ where: { incident: { serviceId: service.id } } });
      await prisma.alert.deleteMany({ where: { serviceId: service.id } });
      await prisma.incident.deleteMany({ where: { serviceId: service.id } });
      await prisma.service.delete({ where: { id: service.id } });
    }
  }
);
