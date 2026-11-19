import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors/app-error';
import { logger } from '@/lib/logger';
import { resolveIncidentClassification } from '@/lib/incidents/classification';
import { withDbBudget } from '@/lib/intelligence/jobs/db-budget';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere, incidentReadWhereParts } from '@/lib/authorization-filters';
import { validateAutomationSnapshot } from './authoring';
import { compileAutomation } from './compiler';
import { snapshotSchema, usesIntelligenceFields } from './contract';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { loadServiceSignals } from './intelligence-signals';
import { EMPTY_SIGNALS, inMaintenanceAt, intelligenceContext } from './context/intelligence';
import {
  REPLAY_MAX_DAYS,
  REPLAY_MIN_DAYS,
  replayStoredEvents,
  type ReplayEnvironment,
  type ReplayIncidentScope,
  type ReplaySummary,
} from './replay';

/**
 * Historical replay as a background job: the request stores a run (IntelligenceEvaluationRun, kind
 * REPLAY) and a SCHEDULED_TASK BackgroundJob; the worker replays and writes progress and the result
 * back to the run. Nothing here is reachable from event ingestion.
 */

const SEVERITIES = ['critical', 'error', 'warning', 'info'] as const;
const PAGE_DB_MS = 10_000;
/** An identical request inside this window returns the run that already exists. */
const REUSE_MS = 10 * 60_000;
/** A run the worker never finished is reported as failed after this long. */
const STALE_MS = 10 * 60_000;

export const automationReplayRequestSchema = z
  .object({
    snapshot: snapshotSchema,
    days: z.number().int().min(REPLAY_MIN_DAYS).max(REPLAY_MAX_DAYS).default(REPLAY_MIN_DAYS),
    /** Which integration's field mappings apply; the service's first integration when omitted. */
    integrationType: z.string().min(1).max(64).optional(),
  })
  .strict();

export type AutomationReplayResult = ReplaySummary & { alertsScanned: number; truncated: boolean };

export type AutomationReplayView = {
  runId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  days: number;
  /** 0..1 share of the window already replayed. */
  progress: number;
  result: AutomationReplayResult | null;
  error: string | null;
  createdAt: string;
};

const storedSchema = z.object({
  type: z.literal('AUTOMATION_REPLAY'),
  serviceId: z.string(),
  days: z.number(),
  inputHash: z.string(),
  integrationType: z.string().nullable(),
  progress: z.number(),
  /** Null: the requester reads every incident. Absent on runs queued before scoping existed. */
  incidentScope: z
    .object({ actorId: z.string(), teamIds: z.array(z.string()) })
    .nullable()
    .optional(),
  snapshot: z.unknown().optional(),
  result: z.unknown().optional(),
});

type RunRow = {
  id: string;
  status: AutomationReplayView['status'];
  metrics: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
};
const runSelect = { id: true, status: true, metrics: true, error: true, createdAt: true } as const;

function view(row: RunRow, serviceId: string, now = Date.now()): AutomationReplayView | null {
  const stored = storedSchema.safeParse(row.metrics);
  if (!stored.success || stored.data.serviceId !== serviceId) return null;
  const stale =
    (row.status === 'PENDING' || row.status === 'RUNNING') &&
    now - row.createdAt.getTime() > STALE_MS;
  return {
    runId: row.id,
    status: stale ? 'FAILED' : row.status,
    days: stored.data.days,
    progress: row.status === 'COMPLETED' ? 1 : stored.data.progress,
    result:
      row.status === 'COMPLETED' ? ((stored.data.result as AutomationReplayResult) ?? null) : null,
    error: stale ? 'The replay did not finish. Run it again.' : row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Which incidents a replay may read for this actor: null when it reads every incident. Throws (403)
 * without incident read, because replay results identify incidents and test their alert payloads.
 */
export function replayIncidentScope(actor: AuthorizationActor): ReplayIncidentScope | null {
  return incidentReadWhereParts(actor).global
    ? null
    : { actorId: actor.id, teamIds: [...actor.teamIds] };
}

/** Validates the snapshot and queues a replay; the caller has already authorized the service. */
export async function startAutomationReplay(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof automationReplayRequestSchema> & {
    serviceId: string;
    actorId: string | null;
    /** From `replayIncidentScope`: the replay reads only the incidents the requester can read. */
    incidentScope: ReplayIncidentScope | null;
    now?: Date;
  }
): Promise<AutomationReplayView> {
  const validation = await validateAutomationSnapshot(tx, input.serviceId, input.snapshot);
  const blocking = validation.issues.find(issue => issue.level === 'ERROR');
  if (blocking)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: `Fix the draft before replaying it: ${blocking.message}`,
    });
  const now = input.now ?? new Date();
  const integrationType = input.integrationType ?? null;
  const inputHash = createHash('sha256')
    .update(
      JSON.stringify([
        input.serviceId,
        input.days,
        integrationType,
        input.snapshot,
        input.actorId,
        input.incidentScope,
      ])
    )
    .digest('hex');
  // Bounded by the (kind, createdAt) index and the reuse window.
  const existing = await tx.intelligenceEvaluationRun.findFirst({
    where: {
      kind: 'REPLAY',
      status: { not: 'FAILED' },
      createdAt: { gte: new Date(now.getTime() - REUSE_MS) },
      metrics: { path: ['inputHash'], equals: inputHash },
    },
    orderBy: { createdAt: 'desc' },
    select: runSelect,
  });
  const reused = existing && view(existing, input.serviceId, now.getTime());
  if (reused && reused.status !== 'FAILED') return reused;

  const run = await tx.intelligenceEvaluationRun.create({
    data: {
      kind: 'REPLAY',
      status: 'PENDING',
      windowStart: new Date(now.getTime() - input.days * 86_400_000),
      windowEnd: now,
      createdById: input.actorId,
      metrics: {
        type: 'AUTOMATION_REPLAY',
        serviceId: input.serviceId,
        days: input.days,
        inputHash,
        integrationType,
        progress: 0,
        incidentScope: input.incidentScope,
        snapshot: input.snapshot,
      } as Prisma.InputJsonObject,
    },
    select: runSelect,
  });
  await tx.backgroundJob.create({
    data: {
      type: 'SCHEDULED_TASK',
      scheduledAt: now,
      // The run row records failure; a retry would only replay the same window again.
      maxAttempts: 1,
      payload: { task: 'AUTOMATION_REPLAY', runId: run.id },
    },
  });
  return view(run, input.serviceId, now.getTime())!;
}

/**
 * Null when the run does not exist, belongs to another service or was requested by someone else.
 * Examples are re-checked against the reader's incident visibility, which may have narrowed since.
 */
export async function getAutomationReplay(
  client: Pick<Prisma.TransactionClient, 'intelligenceEvaluationRun' | 'incident'>,
  serviceId: string,
  runId: string,
  actor: AuthorizationActor
): Promise<AutomationReplayView | null> {
  const row = await client.intelligenceEvaluationRun.findFirst({
    where: { id: runId, kind: 'REPLAY', createdById: actor.id },
    select: runSelect,
  });
  const replay = row ? view(row, serviceId) : null;
  if (!replay?.result?.examples.length) return replay;
  const ids = replay.result.examples.map(example => example.incidentId);
  const readable = await client.incident.findMany({
    where: { AND: [{ id: { in: ids } }, incidentReadWhere(actor)] },
    select: { id: true },
  });
  const allowed = new Set(readable.map(incident => incident.id));
  return {
    ...replay,
    result: {
      ...replay.result,
      examples: replay.result.examples.filter(example => allowed.has(example.incidentId)),
    },
  };
}

/** What every event in one replay shares: default policy, integration type and base classification. */
export async function loadReplayEnvironment(
  tx: Prisma.TransactionClient,
  serviceId: string,
  integrationType: string | null
): Promise<ReplayEnvironment> {
  const service = await tx.service.findUnique({
    where: { id: serviceId },
    select: {
      escalationPolicyId: true,
      integrations: { select: { type: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });
  if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  const classified = new Map<string, { priority: string | null; urgency: string }>();
  for (const alertSeverity of SEVERITIES) {
    const { priority, urgency } = await resolveIncidentClassification(tx, {
      serviceId,
      alertSeverity,
    });
    classified.set(alertSeverity, { priority, urgency });
  }
  return {
    integrationType: integrationType ?? service.integrations[0]?.type ?? 'EVENTS_API_V2',
    defaultPolicyId: service.escalationPolicyId,
    classify: severity => classified.get(severity) ?? { priority: null, urgency: 'HIGH' },
  };
}

/**
 * The intelligence fields as they stood at each replayed event, rebuilt from stored evidence in one bounded
 * read. With the switch off live traffic reads them as unknown, so replay does too (returns undefined).
 */
export async function loadReplayIntelligence(
  tx: Prisma.TransactionClient,
  serviceId: string,
  from: Date,
  to: Date
): Promise<ReplayEnvironment['intelligence']> {
  const settings = await getIntelligenceSettings(tx);
  if (!settings.enabled || !settings.automationIntelligenceFieldsEnabled) return undefined;
  const [signals, windows, service] = await Promise.all([
    loadServiceSignals(tx, { from, to, serviceId }),
    tx.noiseMaintenanceWindow.findMany({
      where: {
        enabled: true,
        scope: { in: ['SERVICE', 'TEAM', 'ALL'] },
        startsAt: { lte: to },
        OR: [{ recurrence: { not: null } }, { endsAt: { gte: from } }],
      },
      select: {
        scope: true,
        serviceId: true,
        teamId: true,
        startsAt: true,
        endsAt: true,
        recurrence: true,
        endedAt: true,
      },
      take: 2_000,
    }),
    tx.service.findUnique({ where: { id: serviceId }, select: { teamId: true } }),
  ]);
  const own = signals.get(serviceId) ?? EMPTY_SIGNALS;
  const scope = { serviceId, teamId: service?.teamId ?? null };
  return at =>
    intelligenceContext({ signals: own, inMaintenance: inMaintenanceAt(windows, scope, at), at });
}

/** Worker entry point. Failures land on the run row, so the job itself always completes. */
export async function processAutomationReplay(runId: string) {
  const claimed = await prisma.intelligenceEvaluationRun.updateMany({
    where: { id: runId, kind: 'REPLAY', status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  if (!claimed.count) return;
  try {
    const run = await prisma.intelligenceEvaluationRun.findUniqueOrThrow({
      where: { id: runId },
      select: { metrics: true, windowStart: true, windowEnd: true },
    });
    const stored = storedSchema.parse(run.metrics);
    const { compiled, issues } = compileAutomation(stored.snapshot);
    if (issues.some(issue => issue.level === 'ERROR')) throw new Error('The draft is not valid.');
    const environment = await withDbBudget({ maxDbMs: PAGE_DB_MS }, tx =>
      loadReplayEnvironment(tx, stored.serviceId, stored.integrationType)
    );
    if (usesIntelligenceFields(compiled))
      environment.intelligence = await withDbBudget({ maxDbMs: PAGE_DB_MS }, tx =>
        loadReplayIntelligence(tx, stored.serviceId, run.windowStart, run.windowEnd)
      );
    const result = await replayStoredEvents({
      compiled,
      serviceId: stored.serviceId,
      environment,
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
      incidentScope: stored.incidentScope ?? null,
      run: work => withDbBudget({ maxDbMs: PAGE_DB_MS }, work),
      onProgress: async progress => {
        await prisma.$executeRaw`
          UPDATE "IntelligenceEvaluationRun"
          SET "metrics" = jsonb_set("metrics", '{progress}', to_jsonb(${progress.fraction}::float8))
          WHERE "id" = ${runId}`;
      },
    });
    const kept = { ...stored };
    // The snapshot is dropped once replayed: the run keeps counts, not rule definitions.
    delete kept.snapshot;
    await prisma.intelligenceEvaluationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        metrics: { ...kept, progress: 1, result } as unknown as Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    logger.warn('[Automation] Replay failed', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    await prisma.intelligenceEvaluationRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: 'The replay could not be completed. Run it again.',
      },
    });
  }
}
