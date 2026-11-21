import 'server-only';
/* eslint-disable security/detect-object-injection -- Indexes of a parallel array built in the same function. */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureScheduleCoverage } from '@/lib/oncall-load/store';
import {
  ATTEMPT_BACKFILL_CURSOR,
  ATTEMPT_BACKFILL_DONE,
  backfillEscalationStepAttemptsBatch,
} from '@/lib/escalation/step-attempt-backfill';
import { dbNow, withDbBudget } from '../jobs/db-budget';
import { stableAnalysisHash } from '../jobs/input-hash';
import {
  enqueueWorkItems,
  WORK_KINDS,
  type ClaimedWorkItem,
  type WorkKind,
} from '../jobs/work-queue';
import { getIntelligenceSettings, type IntelligenceSettingsView } from '../settings/service';
import {
  enabledOpsInsightAreas,
  OPS_INSIGHT_SCOPE_TYPES,
  type OpsInsightScope,
  type OpsInsightScopeType,
} from './contract';
import type { AnyOpsInsightProducer } from './producer';
import { OPS_INSIGHT_PRODUCERS } from './producers';
import { resolveInsightsExcept, scopeTable, upsertInsights } from './store';

type Client = Prisma.TransactionClient | typeof prisma;

export const OPS_INSIGHTS_SCHEDULE = {
  /** How often the lane looks for scopes that are due. */
  scanIntervalMs: 15 * 60_000,
  /** A scope is recomputed once a day. */
  recomputeAfterMs: 24 * 60 * 60_000,
  /** Scopes enqueued per scope type per scan: about 19,000 a day per type. */
  perScan: 200,
} as const;

export function opsInsightsSubject(scope: OpsInsightScope): string {
  return `${scope.type}:${scope.id}`;
}

export function parseOpsInsightsSubject(subjectKey: string): OpsInsightScope | null {
  const split = subjectKey.indexOf(':');
  const type = subjectKey.slice(0, split) as OpsInsightScopeType;
  const id = subjectKey.slice(split + 1);
  return split > 0 && id && OPS_INSIGHT_SCOPE_TYPES.includes(type) ? { type, id } : null;
}

function activeProducers(
  settings: IntelligenceSettingsView,
  producers: readonly AnyOpsInsightProducer[]
): AnyOpsInsightProducer[] {
  const areas = enabledOpsInsightAreas(settings);
  return producers.filter(producer => areas.includes(producer.area));
}

/**
 * Asks the lane to recompute one or more scopes soon, after a change that matters to them (a policy was
 * edited, a runbook published). Coalesced: any number of calls for one scope is one work item. Costs one
 * settings read and one upsert, and nothing is queued while operations insights are off.
 *
 * Call it from edit paths only: never from event ingestion, the escalation worker or notification dispatch.
 */
export async function enqueueOpsInsights(
  scopes: OpsInsightScope | readonly OpsInsightScope[],
  client: Client = prisma
): Promise<number> {
  const list = Array.isArray(scopes) ? scopes : [scopes as OpsInsightScope];
  if (list.length === 0) return 0;
  if (!(await getIntelligenceSettings()).opsInsightsEnabled) return 0;
  return enqueueWorkItems(
    list.map(scope => ({ kind: WORK_KINDS.OPS_INSIGHTS, subjectKey: opsInsightsSubject(scope) })),
    client
  );
}

export type OpsInsightsRunOutcome = 'off' | 'invalid' | 'gone' | 'unchanged' | 'computed';

/**
 * One work item: every active producer of one scope, in one budgeted transaction. Idempotent and
 * generation-fenced. When the producers' inputs are what they were last time, nothing is derived or written
 * except the "computed at" stamp.
 */
export async function runOpsInsights(
  item: Pick<ClaimedWorkItem, 'subjectKey' | 'generation' | 'force'>,
  settings: IntelligenceSettingsView,
  options: { signal?: AbortSignal; producers?: readonly AnyOpsInsightProducer[] } = {}
): Promise<OpsInsightsRunOutcome> {
  const scope = parseOpsInsightsSubject(item.subjectKey);
  if (!scope) return 'invalid';
  if (!settings.opsInsightsEnabled) return 'off';
  const producers = activeProducers(settings, options.producers ?? OPS_INSIGHT_PRODUCERS).filter(
    producer => producer.scopeType === scope.type
  );
  const key = { scopeType_scopeId: { scopeType: scope.type, scopeId: scope.id } };

  return withDbBudget(
    settings,
    async tx => {
      const exists = await tx.$queryRaw<unknown[]>(
        Prisma.sql`SELECT 1 FROM ${scopeTable(scope.type)} WHERE "id" = ${scope.id}`
      );
      if (exists.length === 0) {
        await tx.opsInsight.deleteMany({ where: { scopeType: scope.type, scopeId: scope.id } });
        await tx.opsInsightScopeState.deleteMany({
          where: { scopeType: scope.type, scopeId: scope.id },
        });
        return 'gone';
      }

      const now = await dbNow(tx);
      const inputs: unknown[] = [];
      for (const producer of producers) inputs.push(await producer.loadInput(scope, { tx, now }));
      const inputHash = stableAnalysisHash(
        producers.map((producer, index) => [producer.kind, producer.version, inputs[index]])
      );

      const state = await tx.opsInsightScopeState.findUnique({ where: key });
      if (state?.inputHash === inputHash && !item.force) {
        await tx.opsInsightScopeState.update({ where: key, data: { computedAt: now } });
        return 'unchanged';
      }

      for (const [index, producer] of producers.entries()) {
        const input = inputs[index];
        const items = input === null || input === undefined ? [] : producer.derive(input as never);
        await upsertInsights(scope, producer.kind, items, {
          area: producer.area,
          generation: item.generation,
          client: tx,
        });
      }
      // Kinds whose area was switched off, or whose producer no longer exists, stop being reported.
      await resolveInsightsExcept(
        scope,
        producers.map(producer => producer.kind),
        tx
      );
      await tx.opsInsightScopeState.upsert({
        where: key,
        create: { scopeType: scope.type, scopeId: scope.id, inputHash, computedAt: now },
        update: { inputHash, computedAt: now },
      });
      return 'computed';
    },
    prisma,
    { signal: options.signal }
  );
}

/**
 * The one write the lane does for a scope before its insights: a schedule's daily coverage snapshot
 * (finished days only, never rewritten), so on-call history survives later layer edits.
 */
async function captureBeforeInsights(
  subjectKey: string,
  settings: IntelligenceSettingsView
): Promise<void> {
  const scope = parseOpsInsightsSubject(subjectKey);
  if (scope?.type !== 'SCHEDULE' || !enabledOpsInsightAreas(settings).includes('onCall')) return;
  try {
    await captureScheduleCoverage(scope.id);
  } catch (error) {
    // The snapshot resumes from its last captured day on the next visit; insights still run.
    logger.warn('[Intelligence] On-call coverage snapshot failed', {
      scheduleId: scope.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type Handler = (
  item: ClaimedWorkItem,
  context: { settings: IntelligenceSettingsView; signal: AbortSignal }
) => Promise<void>;

export { ATTEMPT_BACKFILL_CURSOR };
const ATTEMPT_BACKFILL_SUBJECT = 'window';

/**
 * One batch of the escalation-attempt backfill (J2), resumable across items and restarts: the keyset cursor
 * is saved in the same budgeted transaction as the batch's inserts. Nothing while escalation insights are
 * off; nothing once the window is done. Returns true when there is more to do.
 */
export async function runEscalationAttemptBackfill(
  settings: IntelligenceSettingsView,
  options: { signal?: AbortSignal; now?: Date } = {}
): Promise<boolean> {
  if (!enabledOpsInsightAreas(settings).includes('escalation')) return false;
  return withDbBudget(
    settings,
    tx => backfillEscalationStepAttemptsBatch(tx, { now: options.now }),
    prisma,
    { signal: options.signal }
  );
}

/** Registered into the runner's DEFAULT_HANDLERS. */
export const OPS_INSIGHT_HANDLERS: Partial<Record<WorkKind, Handler>> = {
  [WORK_KINDS.OPS_INSIGHTS]: async (item, { settings, signal }) => {
    await captureBeforeInsights(item.subjectKey, settings);
    await runOpsInsights(item, settings, { signal });
  },
  [WORK_KINDS.BACKFILL_ESCALATION_ATTEMPTS]: async (item, { settings, signal }) => {
    if ((await runEscalationAttemptBackfill(settings, { signal })) && !signal.aborted)
      await enqueueWorkItems([{ kind: item.kind as WorkKind, subjectKey: item.subjectKey }]);
  },
};

const schedule = { scanAt: 0 };

/** Tests only: forget when scopes were last scanned. */
export function resetOpsInsightsSchedule(): void {
  schedule.scanAt = 0;
}

/**
 * Scopes of one type whose insights are older than a day (never computed first), oldest first. One anti-join
 * between the scope table's primary key and the state table's primary key, capped by LIMIT.
 */
export function dueOpsInsightScopesSql(type: OpsInsightScopeType, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT scope."id" FROM ${scopeTable(type)} scope
    LEFT JOIN "OpsInsightScopeState" state
      ON state."scopeType" = ${type}::"OpsInsightScopeType" AND state."scopeId" = scope."id"
    WHERE state."computedAt" IS NULL
       OR state."computedAt" < now() - (${OPS_INSIGHTS_SCHEDULE.recomputeAfterMs} * interval '1 millisecond')
    ORDER BY state."computedAt" ASC NULLS FIRST, scope."id" ASC
    LIMIT ${limit}`;
}

/**
 * Called once per lane cycle. Does nothing between scans, and one settings read per scan while the feature
 * is off. A scan enqueues a bounded number of due scopes per scope type that has an active producer, each
 * at a random moment before the next scan, so a large estate is spread over the day instead of arriving at
 * once.
 */
export async function scheduleOpsInsightsWork(
  now: number,
  handlers: Partial<Record<WorkKind, unknown>>,
  options: { producers?: readonly AnyOpsInsightProducer[]; random?: () => number } = {}
): Promise<number> {
  if (!handlers[WORK_KINDS.OPS_INSIGHTS]) return 0;
  if (now - schedule.scanAt < OPS_INSIGHTS_SCHEDULE.scanIntervalMs) return 0;
  schedule.scanAt = now;
  const settings = await getIntelligenceSettings();
  const types = new Set(
    activeProducers(settings, options.producers ?? OPS_INSIGHT_PRODUCERS).map(
      producer => producer.scopeType
    )
  );
  if (types.size === 0) return 0;

  // The backfill re-queues itself batch by batch; this only (re)starts it, until its cursor says done.
  let enqueued = 0;
  if (
    handlers[WORK_KINDS.BACKFILL_ESCALATION_ATTEMPTS] &&
    enabledOpsInsightAreas(settings).includes('escalation') &&
    (await prisma.intelligenceCursor.findUnique({ where: { name: ATTEMPT_BACKFILL_CURSOR } }))
      ?.lastId !== ATTEMPT_BACKFILL_DONE
  )
    enqueued += await enqueueWorkItems([
      { kind: WORK_KINDS.BACKFILL_ESCALATION_ATTEMPTS, subjectKey: ATTEMPT_BACKFILL_SUBJECT },
    ]);

  const random = options.random ?? Math.random;
  for (const type of types) {
    const due = await withDbBudget(settings, tx =>
      tx.$queryRaw<Array<{ id: string }>>(
        dueOpsInsightScopesSql(type, OPS_INSIGHTS_SCHEDULE.perScan)
      )
    );
    enqueued += await enqueueWorkItems(
      due.map(row => ({
        kind: WORK_KINDS.OPS_INSIGHTS,
        subjectKey: opsInsightsSubject({ type, id: row.id }),
        scheduledAt: new Date(now + Math.floor(random() * OPS_INSIGHTS_SCHEDULE.scanIntervalMs)),
      }))
    );
  }
  return enqueued;
}
