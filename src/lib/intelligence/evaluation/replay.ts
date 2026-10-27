import 'server-only';
import prisma from '@/lib/prisma';
import { INTELLIGENCE_ENGINE_VERSION, type CorrelationRule } from '../contract';
import { withDbBudget } from '../jobs/db-budget';
import type { IntelligenceSettingsView } from '../settings/service';
import { simulateCorrelation, type ReplayIncident, type ReplayResult } from './simulate';

/** Hard cap on incidents read for a preview, independent of settings, so it can never become a scan. */
export const REPLAY_MAX_INCIDENTS = 5000;
export const REPLAY_MAX_DAYS = 90;

export interface ReplayRequest {
  rules: readonly CorrelationRule[];
  days: number;
  createdById: string | null;
  now?: Date;
}

export interface ReplayOutcome extends ReplayResult {
  runId: string;
  days: number;
  /** True when the window held more incidents than the cap, so results cover the most recent ones only. */
  truncated: boolean;
}

/**
 * Replays a candidate rule set over recent history and records the run. Read-only with respect to
 * incidents; the only write is the evaluation record. Bounded by days, settings and a hard row cap.
 */
export async function replayPolicyRules(
  settings: Pick<IntelligenceSettingsView, 'lookbackDays' | 'maxDbMs'>,
  request: ReplayRequest
): Promise<ReplayOutcome> {
  const now = request.now ?? new Date();
  const days = Math.max(1, Math.min(request.days, settings.lookbackDays, REPLAY_MAX_DAYS));
  const windowStart = new Date(now.getTime() - days * 86_400_000);

  const run = await prisma.intelligenceEvaluationRun.create({
    data: { kind: 'REPLAY', status: 'RUNNING', windowStart, windowEnd: now, createdById: request.createdById, startedAt: now },
  });
  try {
    const rows = await withDbBudget({ maxDbMs: Math.max(settings.maxDbMs, 10_000) }, tx =>
      tx.incidentFingerprint.findMany({
        where: { incidentCreatedAt: { gte: windowStart, lte: now } },
        orderBy: { incidentCreatedAt: 'desc' },
        take: REPLAY_MAX_INCIDENTS + 1,
        select: {
          incidentId: true,
          serviceId: true,
          template: true,
          labels: true,
          incidentCreatedAt: true,
          incident: { select: { urgency: true } },
        },
      })
    );
    const truncated = rows.length > REPLAY_MAX_INCIDENTS;
    const incidents: ReplayIncident[] = rows.slice(0, REPLAY_MAX_INCIDENTS).map(row => ({
      id: row.incidentId,
      serviceId: row.serviceId,
      urgency: row.incident.urgency,
      createdAt: row.incidentCreatedAt,
      template: row.template,
      labels:
        row.labels && typeof row.labels === 'object' && !Array.isArray(row.labels)
          ? Object.fromEntries(Object.entries(row.labels).filter((e): e is [string, string] => typeof e[1] === 'string'))
          : {},
    }));
    const result = simulateCorrelation(incidents, request.rules);
    await prisma.intelligenceEvaluationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        metrics: {
          engineVersion: INTELLIGENCE_ENGINE_VERSION,
          truncated,
          incidentsEvaluated: result.incidentsEvaluated,
          criticalExcluded: result.criticalExcluded,
          groups: result.groups,
          groupedIncidents: result.groupedIncidents,
          suggestedLinks: result.suggestedLinks,
          perRule: result.perRule.map(entry => ({ ...entry })),
        },
      },
    });
    return { ...result, runId: run.id, days, truncated };
  } catch (error) {
    await prisma.intelligenceEvaluationRun
      .update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
      })
      .catch(() => undefined);
    throw error;
  }
}
