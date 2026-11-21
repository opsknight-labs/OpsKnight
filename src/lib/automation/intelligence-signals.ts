import { Prisma } from '@prisma/client';
import type prisma from '@/lib/prisma';
import { INTELLIGENCE_SIGNALS, type ServiceSignals } from './context/intelligence';

type Client = Prisma.TransactionClient | typeof prisma;

const ROW_CAP = 5_000;

/**
 * Bounded, index-backed reads of the evidence behind the intelligence fields, grouped per service. Run off
 * the hot path only: by the 30 s pre-paging snapshot (all services, the last hour) and by replay (one
 * service, the replay range). Never per event.
 */
export async function loadServiceSignals(
  client: Client,
  range: { from: Date; to: Date; serviceId?: string }
): Promise<Map<string, ServiceSignals>> {
  const longest = Math.max(
    INTELLIGENCE_SIGNALS.riskyChangeMinutes,
    INTELLIGENCE_SIGNALS.flappingMinutes,
    INTELLIGENCE_SIGNALS.stormMinutes
  );
  const since = new Date(range.from.getTime() - longest * 60_000);
  const service = range.serviceId ? { serviceId: range.serviceId } : {};
  const serviceSql = range.serviceId
    ? Prisma.sql`AND o."serviceId" = ${range.serviceId}`
    : Prisma.empty;
  const [changes, decisions, slo] = await Promise.all([
    client.changeEvent.findMany({
      where: {
        serviceId: range.serviceId ?? { not: null },
        riskScore: { gte: INTELLIGENCE_SIGNALS.riskThreshold },
        occurredAt: { gte: since, lte: range.to },
      },
      select: { serviceId: true, occurredAt: true },
      take: ROW_CAP,
    }),
    client.prePagingDecision.findMany({
      where: {
        ...service,
        control: { in: ['FLAPPING', 'STORM'] },
        createdAt: { gte: since, lte: range.to },
      },
      select: { serviceId: true, control: true, createdAt: true },
      take: ROW_CAP,
    }),
    // Live: each objective's latest decided snapshot. Replay: every decided snapshot that ends in range,
    // plus the one in force when the range starts.
    client.$queryRaw<
      Array<{ serviceId: string; objectiveId: string; endAt: Date; breached: boolean }>
    >(Prisma.sql`
      -- One index probe per objective on (objectiveId, periodEnd), not a read of its whole history.
      SELECT o."serviceId", o."id" AS "objectiveId", s."endAt", s."breached"
      FROM "ServiceObjective" o
      CROSS JOIN LATERAL (
        SELECT s."periodEnd" AS "endAt", s."breached"
        FROM "ServiceObjectiveSnapshot" s
        WHERE s."objectiveId" = o."id"
          AND s."breached" IS NOT NULL AND s."periodEnd" < ${range.from}
        ORDER BY s."periodEnd" DESC
        LIMIT 1
      ) s
      WHERE o."serviceId" IS NOT NULL ${serviceSql}
        AND (o."activeTo" IS NULL OR o."activeTo" > ${range.from})
      UNION ALL
      SELECT o."serviceId", s."objectiveId", s."periodEnd" AS "endAt", s."breached"
      FROM "ServiceObjectiveSnapshot" s
      JOIN "ServiceObjective" o ON o."id" = s."objectiveId"
      WHERE o."serviceId" IS NOT NULL ${serviceSql}
        AND s."breached" IS NOT NULL
        AND s."periodEnd" >= ${range.from} AND s."periodEnd" <= ${range.to}
      LIMIT ${ROW_CAP}`),
  ]);
  const signals = new Map<
    string,
    {
      riskyChangeAt: number[];
      flappingAt: number[];
      stormAt: number[];
      slo: ServiceSignals['slo'][number][];
    }
  >();
  const of = (serviceId: string) => {
    let entry = signals.get(serviceId);
    if (!entry)
      signals.set(serviceId, (entry = { riskyChangeAt: [], flappingAt: [], stormAt: [], slo: [] }));
    return entry;
  };
  for (const row of changes)
    if (row.serviceId) of(row.serviceId).riskyChangeAt.push(row.occurredAt.getTime());
  for (const row of decisions)
    (row.control === 'FLAPPING' ? of(row.serviceId).flappingAt : of(row.serviceId).stormAt).push(
      row.createdAt.getTime()
    );
  for (const row of slo)
    of(row.serviceId).slo.push({
      objectiveId: row.objectiveId,
      endAt: row.endAt.getTime(),
      breached: row.breached,
    });
  return signals;
}
