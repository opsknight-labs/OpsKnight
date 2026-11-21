import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSloBurn } from '@/lib/slo/burn';

/**
 * Why an upcoming shift may be heavy: services behind the schedule that carry a known risk right now.
 * Read-only and bounded: three index-backed queries plus at most MAX_SLO_PROBES burn reads.
 */
export type ShiftRiskKind = 'RISKY_CHANGE' | 'SLO_BURNING' | 'MAINTENANCE_ENDING';
export type ShiftRiskSignal = { kind: ShiftRiskKind; serviceId: string; serviceName: string };

/** Matches the "High risk" band of the change panel. */
export const RISKY_CHANGE_SCORE = 0.6;
/** A risky change counts as still open for this long after it happened. */
export const RISKY_CHANGE_HOURS = 24;
const MAX_SERVICES = 25;
const MAX_SLO_PROBES = 5;

type Client = Prisma.TransactionClient | typeof prisma;

export async function loadShiftRiskSignals(
  serviceIds: readonly string[],
  window: { now: Date; shiftEnd: Date },
  client: Client = prisma
): Promise<ShiftRiskSignal[]> {
  const ids = [...new Set(serviceIds)].slice(0, MAX_SERVICES);
  if (ids.length === 0) return [];
  const since = new Date(window.now.getTime() - RISKY_CHANGE_HOURS * 3_600_000);
  const [services, risky, maintenance, withObjectives] = await Promise.all([
    client.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    // idx_change_event_service_recent ("serviceId", "occurredAt" DESC)
    client.changeEvent.groupBy({
      by: ['serviceId'],
      where: {
        serviceId: { in: ids },
        occurredAt: { gte: since },
        riskScore: { gte: RISKY_CHANGE_SCORE },
      },
    }),
    // shortcut: one-off service windows only; a recurring window's next end is not expanded here.
    client.noiseMaintenanceWindow.groupBy({
      by: ['serviceId'],
      where: {
        serviceId: { in: ids },
        enabled: true,
        endedAt: null,
        endsAt: { gt: window.now, lte: window.shiftEnd },
      },
    }),
    client.serviceObjective.groupBy({
      by: ['serviceId'],
      where: {
        serviceId: { in: ids },
        metricType: { in: ['UPTIME', 'AVAILABILITY'] },
        activeFrom: { lte: window.now },
        OR: [{ activeTo: null }, { activeTo: { gt: window.now } }],
      },
    }),
  ]);
  const names = new Map(services.map(service => [service.id, service.name]));
  const signals: ShiftRiskSignal[] = [];
  const push = (kind: ShiftRiskKind, serviceId: string | null) => {
    if (serviceId && names.has(serviceId))
      signals.push({ kind, serviceId, serviceName: names.get(serviceId) ?? '' });
  };
  for (const row of risky) push('RISKY_CHANGE', row.serviceId);
  for (const row of maintenance) push('MAINTENANCE_ENDING', row.serviceId);
  for (const row of withObjectives.slice(0, MAX_SLO_PROBES)) {
    if (!row.serviceId) continue;
    const burn = await getSloBurn(row.serviceId, window.now, client as typeof prisma);
    if (burn?.burning) push('SLO_BURNING', row.serviceId);
  }
  return signals;
}
