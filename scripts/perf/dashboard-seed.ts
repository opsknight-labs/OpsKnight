import { PrismaClient } from '@prisma/client';

const INCIDENT_COUNT = 1084;
if (process.env.PERF_SEED_CONFIRM !== String(INCIDENT_COUNT)) {
  throw new Error(`Set PERF_SEED_CONFIRM=${INCIDENT_COUNT} to create the isolated load fixture.`);
}

async function main() {
  const prisma = new PrismaClient();
  const runId = crypto.randomUUID();
  const now = Date.now();
  try {
  const service = await prisma.service.create({
    data: { name: `Dashboard performance fixture ${runId}` },
  });
  for (let offset = 0; offset < INCIDENT_COUNT; offset += 200) {
    const count = Math.min(200, INCIDENT_COUNT - offset);
    await prisma.incident.createMany({
      data: Array.from({ length: count }, (_, index) => {
        const position = offset + index;
        const createdAt = new Date(now - (position % 30) * 24 * 60 * 60_000);
        const acknowledgedAt = new Date(createdAt.getTime() + 8 * 60_000);
        const resolvedAt = position % 4 === 0 ? new Date(createdAt.getTime() + 45 * 60_000) : null;
        return {
          title: `[dashboard-perf:${runId}] incident ${position + 1}`,
          serviceId: service.id,
          urgency: position % 10 === 0 ? ('HIGH' as const) : ('LOW' as const),
          status: resolvedAt ? ('RESOLVED' as const) : ('ACKNOWLEDGED' as const),
          createdAt,
          acknowledgedAt,
          resolvedAt,
          slaAckElapsedMs: BigInt(8 * 60_000),
          slaResolveElapsedMs: resolvedAt ? BigInt(45 * 60_000) : null,
        };
      }),
    });
  }
    console.log(JSON.stringify({ runId, serviceId: service.id, incidents: INCIDENT_COUNT }));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
