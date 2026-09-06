import { PrismaClient } from '@prisma/client';
import { calculateSLAMetrics } from '../../src/lib/sla-server';

const EXPECTED_INCIDENTS = 1084;
const ITERATIONS = 10;
const serviceId = process.env.PERF_SERVICE_ID;

if (!serviceId) throw new Error('Set PERF_SERVICE_ID to the isolated fixture service ID.');

function percentile(values: number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const incidentCount = await prisma.incident.count({ where: { serviceId } });
    if (incidentCount !== EXPECTED_INCIDENTS) {
      throw new Error(`Expected ${EXPECTED_INCIDENTS} isolated incidents; found ${incidentCount}.`);
    }

    const durations: number[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const startedAt = performance.now();
      await calculateSLAMetrics({
        serviceId,
        includeAllTime: true,
        includeIncidents: false,
        includeActiveIncidents: false,
        incidentLimit: 0,
      });
      durations.push(performance.now() - startedAt);
    }

    const result = {
      serviceId,
      incidentCount,
      iterations: ITERATIONS,
      coldMs: Math.round(durations[0]),
      p50Ms: Math.round(percentile(durations, 0.5)),
      p95Ms: Math.round(percentile(durations, 0.95)),
      maxMs: Math.round(Math.max(...durations)),
    };
    console.log(JSON.stringify(result));
    if (result.p95Ms >= 5_000) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
