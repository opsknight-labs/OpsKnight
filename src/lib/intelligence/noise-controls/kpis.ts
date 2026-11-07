import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type Client = Prisma.TransactionClient | typeof prisma;

export interface NoiseControlKpis {
  days: number;
  alerts: number;
  incidents: number;
  /** Alerts per incident: how much the pipeline compresses. Higher is better. */
  compressionRatio: number;
  /** Applied decisions that kept an alert from paging (suppressed, dropped, appended, grouped). */
  pagesAvoided: number;
  /** The same count for SHADOW decisions: what turning ON would have avoided. */
  shadowWouldAvoid: number;
  downgraded: number;
  held: number;
  /** Applied APPEND/GROUP_CHILD decisions an operator reversed, over all applied groupings. */
  falseGroupRate: number;
  grouped: number;
  ungrouped: number;
  perSource: Array<{
    sourceId: string | null;
    sourceName: string | null;
    control: string;
    action: string;
    count: number;
  }>;
  heartbeats: { monitors: number; missing: number; late: number };
}

const AVOIDING = ['SUPPRESS', 'DROP', 'APPEND', 'GROUP_CHILD'] as const;

export async function getNoiseControlKpis(
  options: { days?: number; serviceId?: string | null; now?: Date } = {},
  client: Client = prisma
): Promise<NoiseControlKpis> {
  const days = Math.max(1, Math.min(options.days ?? 7, 90));
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const serviceWhere = options.serviceId ? { serviceId: options.serviceId } : {};
  const [alerts, incidents, decisions, perSource, monitors] = await Promise.all([
    client.alert.count({ where: { ...serviceWhere, createdAt: { gte: since } } }),
    client.incident.count({ where: { ...serviceWhere, createdAt: { gte: since } } }),
    client.prePagingDecision.groupBy({
      by: ['mode', 'action'],
      where: { ...serviceWhere, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    client.prePagingDecision.groupBy({
      by: ['sourceId', 'sourceName', 'control', 'action'],
      where: { ...serviceWhere, createdAt: { gte: since }, applied: true },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    }),
    client.heartbeatMonitor.groupBy({
      by: ['state'],
      where: { ...serviceWhere, enabled: true },
      _count: { _all: true },
    }),
  ]);
  const count = (mode: 'SHADOW' | 'ON', actions: readonly string[]) =>
    decisions
      .filter(row => row.mode === mode && actions.includes(row.action))
      .reduce((sum, row) => sum + row._count._all, 0);
  const [grouped, ungrouped] = await Promise.all([
    client.prePagingDecision.count({
      where: {
        ...serviceWhere,
        createdAt: { gte: since },
        applied: true,
        action: { in: ['APPEND', 'GROUP_CHILD'] },
      },
    }),
    client.prePagingDecision.count({
      where: {
        ...serviceWhere,
        createdAt: { gte: since },
        applied: true,
        action: { in: ['APPEND', 'GROUP_CHILD'] },
        reversedAt: { not: null },
      },
    }),
  ]);
  const monitorCount = (state: string) =>
    monitors.find(row => row.state === state)?._count._all ?? 0;
  return {
    days,
    alerts,
    incidents,
    compressionRatio:
      incidents === 0 ? (alerts === 0 ? 1 : alerts) : Math.round((alerts / incidents) * 100) / 100,
    pagesAvoided: count('ON', AVOIDING),
    shadowWouldAvoid: count('SHADOW', AVOIDING),
    downgraded: count('ON', ['DOWNGRADE']),
    held: count('ON', ['HOLD']),
    falseGroupRate: grouped === 0 ? 0 : Math.round((ungrouped / grouped) * 10_000) / 10_000,
    grouped,
    ungrouped,
    perSource: perSource.map(row => ({
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      control: row.control,
      action: row.action,
      count: row._count._all,
    })),
    heartbeats: {
      monitors: monitors.reduce((sum, row) => sum + row._count._all, 0),
      missing: monitorCount('MISSING'),
      late: monitorCount('LATE'),
    },
  };
}
