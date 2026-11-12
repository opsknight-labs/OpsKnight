import 'server-only';
import { Prisma } from '@prisma/client';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { upstreamDistances } from '../dependencies/graph';

/**
 * Change risk: how likely a change is to be followed by an incident, as a 0..1 ranking signal. It is
 * computed in the lane after a change is recorded, from four deterministic components, and stored on the
 * change so responders see it next to the change on incident and change views. It is never a verdict and
 * never gates anything.
 */

export const RISK_HISTORY_DAYS = 30;
/** A change "was followed by" an incident when one opened on the service within this many minutes. */
export const RISK_FOLLOW_WINDOW_MINUTES = 60;
const MAX_HISTORY_CHANGES = 500;

export interface RiskInput {
  /** Of the source's recent changes on this service, the share followed by an incident (0..1), or null when none. */
  historicalFollowRate: number | null;
  /** How many of the source's recent changes that rate is based on. */
  historicalSample: number;
  /** Services that depend on this one, transitively within the cause depth. */
  blastRadius: number;
  /** Local hour (0..23) and weekday (0 = Sunday) the change happened. */
  hour: number;
  weekday: number;
  /** Operator-supplied size hints, when present in the labels. */
  size: { filesChanged?: number; linesChanged?: number; replicas?: number } | null;
  kind: 'DEPLOY' | 'CONFIG' | 'FEATURE_FLAG' | 'INFRA';
}

export interface RiskScore {
  score: number;
  components: { history: number; blastRadius: number; timing: number; size: number; kind: number };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Prior when there is no history: a typical change is followed by an incident a small fraction of the time. */
const HISTORY_PRIOR = 0.15;
const KIND_RISK = { DEPLOY: 1, INFRA: 0.95, CONFIG: 0.85, FEATURE_FLAG: 0.75 } as const;

export function scoreChangeRisk(input: RiskInput): RiskScore {
  // History: shrink the observed rate towards the prior in proportion to the sample size.
  const sample = Math.max(0, input.historicalSample);
  const observed = input.historicalFollowRate ?? HISTORY_PRIOR;
  const history = (observed * sample + HISTORY_PRIOR * 5) / (sample + 5);
  // Blast radius: saturating in the number of dependants (five dependants ≈ 0.63, twenty ≈ 0.98).
  const blastRadius = 1 - Math.exp(-Math.max(0, input.blastRadius) / 5);
  // Timing: off-hours and weekends are riskier because fewer people are watching and rollbacks are slower.
  const weekend = input.weekday === 0 || input.weekday === 6;
  const offHours = input.hour < 7 || input.hour >= 19;
  const timing = weekend ? 1 : offHours ? 0.7 : 0.3;
  // Size: only when the source told us; saturating in files or lines.
  const files = input.size?.filesChanged ?? 0;
  const lines = input.size?.linesChanged ?? 0;
  const sizeSignal =
    input.size && (files > 0 || lines > 0)
      ? Math.max(1 - Math.exp(-files / 20), 1 - Math.exp(-lines / 500))
      : null;
  const size = sizeSignal ?? 0.4;
  const kind = KIND_RISK[input.kind];
  // Weighted blend; history dominates because it is the only component that is actually about outcomes.
  const score = Math.min(
    1,
    kind * (0.45 * history + 0.25 * blastRadius + 0.15 * timing + 0.15 * size)
  );
  return {
    score: round(score),
    components: {
      history: round(history),
      blastRadius: round(blastRadius),
      timing: round(timing),
      size: round(size),
      kind,
    },
  };
}

function sizeFromLabels(labels: unknown): RiskInput['size'] {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return null;
  const record = labels as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = Object.entries(record).find(([k]) => k.toLowerCase() === key)?.[1];
      const number =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return undefined;
  };
  const size = {
    filesChanged: pick('files_changed', 'fileschanged', 'files'),
    linesChanged: pick('lines_changed', 'lineschanged', 'lines', 'additions'),
    replicas: pick('replicas'),
  };
  return Object.values(size).some(value => value !== undefined) ? size : null;
}

export interface ComputedRisk {
  changeId: string;
  score: RiskScore;
  historicalSample: number;
  blastRadius: number;
}

/**
 * Computes and stores the risk score for one change. Bounded reads: the source's last
 * MAX_HISTORY_CHANGES changes on the service over RISK_HISTORY_DAYS, the incidents that followed them,
 * and the active dependency graph. Returns null when the change no longer exists.
 */
export async function computeChangeRisk(
  tx: Prisma.TransactionClient,
  changeId: string,
  now: Date = new Date()
): Promise<ComputedRisk | null> {
  const change = await tx.changeEvent.findUnique({
    where: { id: changeId },
    select: { id: true, serviceId: true, source: true, kind: true, labels: true, occurredAt: true },
  });
  if (!change) return null;

  let historicalFollowRate: number | null = null;
  let historicalSample = 0;
  if (change.serviceId) {
    const since = new Date(now.getTime() - RISK_HISTORY_DAYS * 86_400_000);
    const [row] = await tx.$queryRaw<Array<{ total: number; followed: number }>>(Prisma.sql`
      WITH recent AS (
        SELECT "id", "occurredAt" FROM "ChangeEvent"
        WHERE "serviceId" = ${change.serviceId} AND "source" = ${change.source}
          AND "occurredAt" >= ${since} AND "occurredAt" < ${change.occurredAt} AND "id" <> ${change.id}
        ORDER BY "occurredAt" DESC LIMIT ${MAX_HISTORY_CHANGES}
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "Incident" i
               WHERE i."serviceId" = ${change.serviceId}
                 AND i."createdAt" >= recent."occurredAt"
                 AND i."createdAt" <= recent."occurredAt" + make_interval(mins => ${RISK_FOLLOW_WINDOW_MINUTES}::int)
             ))::int AS followed
      FROM recent`);
    historicalSample = row?.total ?? 0;
    historicalFollowRate = historicalSample > 0 ? (row?.followed ?? 0) / historicalSample : null;
  }

  // Dependants: walk the graph in reverse so "services that depend on this one" is the blast radius.
  const edges = await loadActiveEdges(tx);
  const dependants = change.serviceId
    ? upstreamDistances(
        edges.map(edge => ({
          upstreamServiceId: edge.downstreamServiceId,
          downstreamServiceId: edge.upstreamServiceId,
        })),
        change.serviceId,
        RESPONSE_LIMITS.maxUpstreamDepth
      ).size
    : 0;

  const score = scoreChangeRisk({
    historicalFollowRate,
    historicalSample,
    blastRadius: dependants,
    hour: change.occurredAt.getUTCHours(),
    weekday: change.occurredAt.getUTCDay(),
    size: sizeFromLabels(change.labels),
    kind: change.kind,
  });
  await tx.changeEvent.update({
    where: { id: change.id },
    data: {
      riskScore: score.score,
      riskEvidence: {
        type: 'change_risk',
        calibrated: false,
        components: score.components,
        historicalSample,
        historicalFollowRate,
        blastRadius: dependants,
        followWindowMinutes: RISK_FOLLOW_WINDOW_MINUTES,
        historyDays: RISK_HISTORY_DAYS,
      },
      riskComputedAt: now,
    },
  });
  return { changeId: change.id, score, historicalSample, blastRadius: dependants };
}
