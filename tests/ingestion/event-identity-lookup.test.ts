import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { findOpenEventIncident, lockEventDedupKeys } from '@/lib/incidents/event-identity';
import { finalizeEscalationExecution } from '@/lib/escalation/repository';

afterAll(() => prisma.$disconnect());

it('finds only the scoped open identity and preserves raw scalar types and transaction visibility', async () => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/^\/ingestion_test_/);
  const services = await Promise.all(
    [0, 1].map(() => prisma.service.create({ data: { name: `Owned identity ${randomUUID()}` } }))
  );
  const key = randomUUID();
  const ids: string[] = [];
  try {
    for (const [serviceId, dedupKey, status] of [
      [services[1].id, key, 'OPEN'],
      [services[0].id, key, 'RESOLVED'],
    ] as const) {
      const row = await prisma.incident.create({
        data: { serviceId, dedupKey, status, title: key },
      });
      ids.push(row.id);
    }
    await prisma.$transaction(async tx => {
      await lockEventDedupKeys(tx, services[0].id, [key, `${key}-legacy`]);
      expect(await findOpenEventIncident(tx, services[0].id, [key])).toBeNull();
      const row = await tx.incident.create({
        data: {
          serviceId: services[0].id,
          dedupKey: `${key}-legacy`,
          title: key,
          status: 'SUPPRESSED',
          slaPausedMs: BigInt(1234),
        },
      });
      ids.push(row.id);
      const found = await findOpenEventIncident(tx, services[0].id, [key, `${key}-legacy`]);
      expect(found).toEqual(row);
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(typeof found?.slaPausedMs).toBe('bigint');
      expect(await findOpenEventIncident(tx, services[0].id, [])).toBeNull();
    });
  } finally {
    await prisma.incident.deleteMany({ where: { id: { in: ids } } });
    await prisma.service.deleteMany({ where: { id: { in: services.map(row => row.id) } } });
  }
});

it('retains finalization generation, step and terminal-state fences', async () => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/^\/ingestion_test_/);
  const service = await prisma.service.create({
    data: { name: `Owned finalization ${randomUUID()}` },
  });
  const incident = await prisma.incident.create({
    data: {
      serviceId: service.id,
      title: 'Owned finalization',
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
      currentEscalationStep: 2,
      escalationGeneration: 7,
    },
  });
  const input = {
    incidentId: incident.id,
    expectedGeneration: 7,
    expectedStep: 2,
    status: 'COMPLETED' as const,
  };
  try {
    expect(await finalizeEscalationExecution({ ...input, expectedGeneration: 6 })).toBe(false);
    expect(await finalizeEscalationExecution({ ...input, expectedStep: 1 })).toBe(false);
    expect(await finalizeEscalationExecution(input)).toBe(true);
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      escalationStatus: 'COMPLETED',
      currentEscalationStep: null,
      escalationGeneration: 7,
    });
    await prisma.incident.update({ where: { id: incident.id }, data: { status: 'RESOLVED' } });
    expect(await finalizeEscalationExecution({ ...input, expectedStep: 0 })).toBe(false);
  } finally {
    await prisma.incident.delete({ where: { id: incident.id } });
    await prisma.service.delete({ where: { id: service.id } });
  }
});
