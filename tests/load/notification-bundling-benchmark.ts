/**
 * Dispatch-path benchmark for low-urgency bundling.
 *
 * Bundling adds one index-backed read to the creation of a page intent, and only for a recipient who
 * opted in and a low-urgency incident. This measures `createCentralNotificationIntent` for the same
 * responder page with bundling OFF and ON, against a recipient who already has a deep notification
 * history, and fails when ON costs more than the allowance over OFF.
 *
 * Run against a migrated scratch database:
 *   DATABASE_URL=... DIRECT_DATABASE_URL=... ENCRYPTION_KEY=<64 hex> \
 *     npx tsx tests/load/notification-bundling-benchmark.ts [out.json]
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import prisma from '../../src/lib/prisma';
import { createCentralNotificationIntent } from '../../src/lib/notification-control-plane';

const SAMPLES = Number(process.env.BUNDLING_BENCH_SAMPLES ?? 400);
const HISTORY = Number(process.env.BUNDLING_BENCH_HISTORY ?? 50_000);
/** ON may cost this much more than OFF at p99 before the run fails. */
const P99_ALLOWANCE_MS = Number(process.env.BUNDLING_BENCH_P99_ALLOWANCE_MS ?? 5);

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

async function main() {
  const run = randomUUID().slice(0, 8);
  const users = await Promise.all(
    ['off', 'on'].map(mode =>
      prisma.user.create({
        data: { name: `bundle bench ${mode}`, email: `bundle-bench-${mode}-${run}@example.com` },
        select: { id: true },
      })
    )
  );
  const service = await prisma.service.create({
    data: { name: `bundle-bench-${run}` },
    select: { id: true },
  });
  const incidents = await prisma.incident.createManyAndReturn({
    data: Array.from({ length: SAMPLES * 2 }, (_, i) => ({
      title: `bundle bench ${i}`,
      serviceId: service.id,
      urgency: 'LOW' as const,
    })),
    select: { id: true },
  });

  // A deep history per recipient, older than the bundling window, so the read has an index to walk.
  for (const user of users) {
    for (let offset = 0; offset < HISTORY; offset += 5_000) {
      await prisma.notification.createMany({
        data: Array.from({ length: Math.min(5_000, HISTORY - offset) }, (_, i) => ({
          userId: user.id,
          channel: 'SMS' as const,
          status: 'SENT' as const,
          category: 'INCIDENT' as const,
          eventType: 'incident-triggered',
          priority: 1,
          createdAt: new Date(Date.now() - 3_600_000 - (offset + i) * 1_000),
        })),
      });
    }
  }
  await prisma.$executeRawUnsafe('ANALYZE "Notification"');

  const samples = { off: [] as number[], on: [] as number[] };
  // Interleaved so drift in the database affects both modes equally.
  for (let i = 0; i < SAMPLES * 2; i += 1) {
    const mode = i % 2 === 0 ? 'off' : 'on';
    const userId = users[mode === 'off' ? 0 : 1].id;
    const incidentId = incidents[i].id;
    const started = performance.now();
    await createCentralNotificationIntent({
      category: 'INCIDENT',
      channel: 'SMS',
      recipientType: 'USER',
      recipientId: userId,
      recipientAddress: mode === 'off' ? '+15550000001' : '+15550000002',
      userId,
      incidentId,
      templateKey: 'incident-triggered',
      sourceType: 'INCIDENT',
      sourceId: incidentId,
      eventKey: `${incidentId}:0`,
      displayMessage: 'Incident notification',
      trafficClass: 'CRITICAL',
      priority: 1,
      bundle: mode === 'on',
      escalationStepIndex: 0,
      payload: {
        kind: 'INCIDENT_SMS',
        userId,
        incidentId,
        eventType: 'triggered',
        eventAt: new Date().toISOString(),
        durableMessage: 'Incident notification',
      } as never,
    });
    // The first few of each mode warm the connection and the plan cache.
    if (i >= 20) samples[mode].push(performance.now() - started);
  }

  const summary = (values: number[]) => ({
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p99Ms: Number(percentile(values, 0.99).toFixed(3)),
  });
  const bundled = await prisma.notification.groupBy({
    by: ['status'],
    where: { userId: users[1].id, createdAt: { gte: new Date(Date.now() - 600_000) } },
    _count: true,
  });
  const result = {
    benchmark: 'notification-bundling-dispatch',
    historyPerRecipient: HISTORY,
    off: summary(samples.off),
    on: summary(samples.on),
    p99AllowanceMs: P99_ALLOWANCE_MS,
    // Sanity: with bundling on, one page went out at once and the rest were held or suppressed.
    onOutcomes: Object.fromEntries(bundled.map(row => [row.status, row._count])),
  };
  const pass = result.on.p99Ms <= result.off.p99Ms + P99_ALLOWANCE_MS;
  console.log(JSON.stringify({ ...result, pass }, null, 2));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ ...result, pass }, null, 2));

  await prisma.notification.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
  await prisma.incident.deleteMany({ where: { serviceId: service.id } });
  await prisma.service.delete({ where: { id: service.id } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  await prisma.$disconnect();
  if (!pass) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
