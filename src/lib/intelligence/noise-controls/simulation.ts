import 'server-only';
import { Prisma, type IncidentUrgency } from '@prisma/client';
import prisma from '@/lib/prisma';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { withDbBudget } from '../jobs/db-budget';
import type { IntelligenceSettingsView } from '../settings/service';
import { compilePolicy, loadPrePagingSnapshot } from './cache';
import {
  noiseScopeKey,
  type NoiseControlDefinition,
  type PrePagingActionName,
  type PrePagingControlName,
  type PrePagingInput,
} from './contract';
import {
  evaluatePrePagingControls,
  type PrePagingLookups,
  type PrePagingSnapshot,
} from './evaluate';

export const SIMULATION_MAX_ALERTS = 20_000;
export const SIMULATION_MAX_DAYS = 30;

export interface SimulationRequest {
  serviceId?: string | null;
  days: number;
  /** Try a definition that is not saved yet; the saved one is used when absent. */
  candidate?: { definition: NoiseControlDefinition };
  createdById: string | null;
  now?: Date;
}

export interface SimulationExample {
  incidentId: string;
  serviceId: string;
  summary: string;
  action: PrePagingActionName;
  control: PrePagingControlName | null;
  reason: string;
  at: Date;
}

export interface SimulationOutcome {
  runId: string;
  days: number;
  incidentsEvaluated: number;
  alertsScanned: number;
  truncated: boolean;
  /** Incidents that would not have paged (suppressed, dropped, appended, grouped). */
  pagesAvoided: number;
  downgraded: number;
  held: number;
  transformed: number;
  failOpen: number;
  byControl: Record<string, number>;
  byAction: Record<string, number>;
  examples: SimulationExample[];
}

type Row = {
  alertId: string;
  incidentId: string;
  serviceId: string;
  teamId: string | null;
  status: string;
  dedupKey: string | null;
  severity: string | null;
  resourceKey: string | null;
  fingerprintHash: string | null;
  labels: unknown;
  payload: unknown;
  urgency: IncidentUrgency;
  createdAt: Date;
  incidentCreatedAt: Date;
};

/**
 * Replays the pre-paging controls over the last `days` of alerts, read-only. Dedup, flapping and storm
 * lookups are answered from the loaded history in memory (incidents are assumed open for the length of
 * their window), so the preview predicts what the hook would decide without touching the live tables.
 */
export async function simulatePrePagingControls(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  request: SimulationRequest
): Promise<SimulationOutcome> {
  const now = request.now ?? new Date();
  const days = Math.max(1, Math.min(request.days, SIMULATION_MAX_DAYS));
  const windowStart = new Date(now.getTime() - days * 86_400_000);
  const run = await prisma.intelligenceEvaluationRun.create({
    data: {
      kind: 'REPLAY',
      status: 'RUNNING',
      windowStart,
      windowEnd: now,
      createdById: request.createdById,
      startedAt: now,
    },
  });
  try {
    const rows = await withDbBudget(
      { maxDbMs: Math.max(settings.maxDbMs, 10_000) },
      tx =>
        tx.$queryRaw<Row[]>`
        SELECT a."id" AS "alertId", i."id" AS "incidentId", a."serviceId", s."teamId", a."status", a."dedupKey",
               a."severity", a."resourceKey", a."fingerprintHash", a."labels", a."payload",
               i."urgency", a."createdAt", i."createdAt" AS "incidentCreatedAt"
        FROM "Alert" a
        JOIN "Incident" i ON i."id" = a."incidentId"
        JOIN "Service" s ON s."id" = a."serviceId"
        WHERE a."createdAt" >= ${windowStart} AND a."createdAt" <= ${now}
          ${request.serviceId ? Prisma.sql`AND a."serviceId" = ${request.serviceId}` : Prisma.empty}
        ORDER BY a."createdAt" ASC
        LIMIT ${SIMULATION_MAX_ALERTS + 1}`
    );
    const truncated = rows.length > SIMULATION_MAX_ALERTS;
    const alerts = rows.slice(0, SIMULATION_MAX_ALERTS);

    let snapshot: PrePagingSnapshot = await loadPrePagingSnapshot(prisma, now);
    if (request.candidate) {
      const scopeKey = noiseScopeKey(request.serviceId ?? null);
      const policies = new Map(snapshot.policies);
      policies.set(
        scopeKey,
        compilePolicy({
          scopeKey,
          serviceId: request.serviceId ?? null,
          mode: 'SHADOW',
          revision: 0,
          definition: request.candidate.definition,
        })
      );
      snapshot = { ...snapshot, policies };
    } else {
      // Preview what the saved controls would do, whatever mode they are in.
      const policies = new Map(
        [...snapshot.policies].map(([key, policy]) => [key, { ...policy, mode: 'SHADOW' as const }])
      );
      snapshot = { ...snapshot, policies };
    }

    // In-memory history for the lookups: rows are replayed in time order, so "earlier" means already seen.
    const seen: Row[] = [];
    const firstAlertOfIncident = new Map<string, string>();
    for (const row of alerts)
      if (!firstAlertOfIncident.has(row.incidentId))
        firstAlertOfIncident.set(row.incidentId, row.alertId);
    const labelsOf = (raw: unknown): Record<string, string> | null =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string'
            )
          )
        : null;
    /** Rows already replayed, newest first, back to `since`. */
    function* recentRows(since: Date): Generator<Row> {
      for (let i = seen.length - 1; i >= 0; i -= 1) {
        const row = seen.at(i);
        if (!row || row.createdAt < since) return;
        yield row;
      }
    }
    const opensIncident = (row: Row) => firstAlertOfIncident.get(row.incidentId) === row.alertId;
    const lookups: PrePagingLookups = {
      async findOpenIncidentByFingerprint(serviceId, hash, since) {
        for (const row of recentRows(since))
          if (
            row.serviceId === serviceId &&
            row.fingerprintHash === hash &&
            row.status === 'TRIGGERED'
          )
            return { id: row.incidentId, labels: labelsOf(row.labels) };
        return null;
      },
      async countRecentIncidents(serviceIds, since) {
        const ids = new Set<string>();
        for (const row of recentRows(since))
          if (serviceIds.includes(row.serviceId) && opensIncident(row)) ids.add(row.incidentId);
        return ids.size;
      },
      async findStormParent(serviceIds, since) {
        let parent: Row | null = null;
        for (const row of recentRows(since))
          if (serviceIds.includes(row.serviceId) && opensIncident(row)) parent = row;
        return parent ? { id: parent.incidentId } : null;
      },
      async recentAlertStatuses(serviceId, key, since, limit) {
        const statuses: string[] = [];
        for (const row of recentRows(since)) {
          if (statuses.length >= limit) break;
          if (
            row.serviceId === serviceId &&
            (row.dedupKey === key.dedupKey ||
              (key.fingerprintHash !== null && row.fingerprintHash === key.fingerprintHash))
          )
            statuses.push(row.status);
        }
        return statuses;
      },
    };

    const outcome: SimulationOutcome = {
      runId: run.id,
      days,
      incidentsEvaluated: 0,
      alertsScanned: alerts.length,
      truncated,
      pagesAvoided: 0,
      downgraded: 0,
      held: 0,
      transformed: 0,
      failOpen: 0,
      byControl: {},
      byAction: {},
      examples: [],
    };
    for (const row of alerts) {
      if (firstAlertOfIncident.get(row.incidentId) === row.alertId && row.status === 'TRIGGERED') {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const input: PrePagingInput = {
          serviceId: row.serviceId,
          teamId: row.teamId,
          source: typeof payload.source === 'string' ? payload.source : 'unknown',
          summary: typeof payload.summary === 'string' ? payload.summary : '',
          severity: row.severity,
          urgency: row.urgency,
          labels: labelsOf(row.labels) ?? {},
          resourceKey: row.resourceKey,
          fingerprintHash: row.fingerprintHash,
          dedupKey: row.dedupKey ?? row.alertId,
          receivedAt: row.createdAt,
        };
        const decision = await evaluatePrePagingControls(input, snapshot, lookups, {
          now: row.createdAt,
          deadlineMs: 250,
        });
        outcome.incidentsEvaluated += 1;
        if (decision.failOpen && decision.failOpen.reason !== 'off') outcome.failOpen += 1;
        if (decision.action !== 'NONE') {
          outcome.byAction[decision.action] = (outcome.byAction[decision.action] ?? 0) + 1;
          if (decision.control)
            outcome.byControl[decision.control] = (outcome.byControl[decision.control] ?? 0) + 1;
          if (['SUPPRESS', 'DROP', 'APPEND', 'GROUP_CHILD'].includes(decision.action))
            outcome.pagesAvoided += 1;
          if (decision.action === 'DOWNGRADE') outcome.downgraded += 1;
          if (decision.action === 'HOLD') outcome.held += 1;
          if (decision.action === 'TRANSFORM') outcome.transformed += 1;
          if (outcome.examples.length < 10)
            outcome.examples.push({
              incidentId: row.incidentId,
              serviceId: row.serviceId,
              summary: input.summary.slice(0, 140),
              action: decision.action,
              control: decision.control,
              reason: decision.reason,
              at: row.createdAt,
            });
        }
      }
      seen.push(row);
    }
    await prisma.intelligenceEvaluationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        metrics: {
          kind: 'prepaging',
          engineVersion: INTELLIGENCE_ENGINE_VERSION,
          serviceId: request.serviceId ?? null,
          candidate: Boolean(request.candidate),
          truncated,
          incidentsEvaluated: outcome.incidentsEvaluated,
          alertsScanned: outcome.alertsScanned,
          pagesAvoided: outcome.pagesAvoided,
          downgraded: outcome.downgraded,
          held: outcome.held,
          transformed: outcome.transformed,
          failOpen: outcome.failOpen,
          byControl: outcome.byControl,
          byAction: outcome.byAction,
        },
      },
    });
    return outcome;
  } catch (error) {
    await prisma.intelligenceEvaluationRun
      .update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
