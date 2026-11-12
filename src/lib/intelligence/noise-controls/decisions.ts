import 'server-only';
import type { NoiseControlMode, Prisma, PrePagingAction, PrePagingControl } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { IntelligenceActor } from '../settings/service';
import type { PrePagingDecisionResult } from './contract';

type Client = Prisma.TransactionClient | typeof prisma;

/** Reversals re-ingest the alert under this integration id, so the new incident pages normally. */
export const NOISE_CONTROL_REVERSAL_INTEGRATION_ID = 'noise-controls:ungroup';

/**
 * Stores a decision next to the alert it was made for. Called by the ingestion hook's integrator inside
 * the ingestion transaction; one small insert, index-backed, nothing else. NONE decisions are not stored
 * (fail-open counts live in metrics), so a quiet service writes nothing.
 */
export async function recordPrePagingDecision(
  tx: Client,
  decision: PrePagingDecisionResult,
  context: { serviceId: string; alertId?: string | null; incidentId?: string | null }
): Promise<string | null> {
  if (decision.action === 'NONE' || !decision.control || decision.mode === 'OFF') return null;
  const row = await tx.prePagingDecision.create({
    data: {
      serviceId: context.serviceId,
      incidentId: context.incidentId ?? decision.targetIncidentId ?? null,
      alertId: context.alertId ?? null,
      control: decision.control as PrePagingControl,
      action: decision.action as PrePagingAction,
      mode: decision.mode as NoiseControlMode,
      applied: decision.apply,
      sourceId: decision.sourceId,
      sourceName: decision.sourceName?.slice(0, 120) ?? null,
      reason: decision.reason.slice(0, 500),
      policyVersionId: decision.policyVersionId ?? null,
      evidence: {
        ...decision.evidence,
        ...(decision.urgency ? { urgency: decision.urgency } : {}),
        ...(decision.holdUntil ? { holdUntil: decision.holdUntil.toISOString() } : {}),
        ...(decision.transform ? { transform: decision.transform } : {}),
        policyRevision: decision.policyRevision,
        elapsedMs: decision.elapsedMs,
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return row.id;
}

export interface PrePagingDecisionRow {
  id: string;
  serviceId: string;
  serviceName: string;
  incidentId: string | null;
  alertId: string | null;
  control: PrePagingControl;
  action: PrePagingAction;
  mode: NoiseControlMode;
  applied: boolean;
  sourceId: string | null;
  sourceName: string | null;
  reason: string;
  reversedAt: Date | null;
  createdAt: Date;
  /** The policy version the decision was evaluated against (null for decisions made before versioning). */
  policyVersionId: string | null;
  policyVersionNumber: number | null;
}

export async function listPrePagingDecisions(
  options: {
    serviceId?: string | null;
    limit?: number;
    control?: PrePagingControl;
    mode?: NoiseControlMode;
  } = {},
  client: Client = prisma
): Promise<PrePagingDecisionRow[]> {
  const rows = await client.prePagingDecision.findMany({
    where: {
      ...(options.serviceId ? { serviceId: options.serviceId } : {}),
      ...(options.control ? { control: options.control } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    select: {
      id: true,
      serviceId: true,
      service: { select: { name: true } },
      incidentId: true,
      alertId: true,
      control: true,
      action: true,
      mode: true,
      applied: true,
      sourceId: true,
      sourceName: true,
      reason: true,
      reversedAt: true,
      createdAt: true,
      policyVersionId: true,
    },
  });
  const versionIds = [
    ...new Set(rows.map(row => row.policyVersionId).filter((v): v is string => Boolean(v))),
  ];
  const versions = versionIds.length
    ? await client.noiseControlPolicyVersion.findMany({
        where: { id: { in: versionIds } },
        select: { id: true, versionNumber: true },
      })
    : [];
  const numbers = new Map(versions.map(version => [version.id, version.versionNumber]));
  return rows.map(({ service, ...row }) => ({
    ...row,
    serviceName: service.name,
    policyVersionNumber: row.policyVersionId ? (numbers.get(row.policyVersionId) ?? null) : null,
  }));
}

export type ReversalOutcome =
  | { outcome: 'reversed'; incidentId: string | null }
  | { outcome: 'already_reversed' }
  | { outcome: 'not_found' };

/**
 * Operator undo. The decision is marked reversed (which also counts as a false positive for readiness
 * and KPIs). When the decision actually kept an alert from paging and the alert is still there, the
 * alert is re-ingested through the normal event path under a reversal-scoped dedup key, so a fresh
 * incident is created and pages exactly like any other: "un-group and page" / "unsuppress and page".
 * Shadow decisions only record the review.
 */
export async function reversePrePagingDecision(
  id: string,
  actor: IntelligenceActor,
  options: { reingest?: boolean } = {}
): Promise<ReversalOutcome> {
  const decision = await prisma.prePagingDecision.findUnique({
    where: { id },
    select: {
      id: true,
      serviceId: true,
      alertId: true,
      action: true,
      applied: true,
      reversedAt: true,
      control: true,
      sourceName: true,
    },
  });
  if (!decision) return { outcome: 'not_found' };
  if (decision.reversedAt) return { outcome: 'already_reversed' };
  const marked = await prisma.prePagingDecision.updateMany({
    where: { id, reversedAt: null },
    data: { reversedAt: new Date(), reversedById: actor.actorId },
  });
  if (marked.count !== 1) return { outcome: 'already_reversed' };
  await logAudit({
    action: 'intelligence.noise.decision.reversed',
    entityType: 'SYSTEM_CONFIG',
    entityId: `prepaging-decision:${id}`,
    actorId: actor.actorId,
    source: actor.source,
    details: { control: decision.control, action: decision.action, applied: decision.applied },
  });

  const pagingWasPrevented =
    decision.applied &&
    ['SUPPRESS', 'APPEND', 'GROUP_CHILD', 'HOLD', 'DROP'].includes(decision.action) &&
    decision.alertId !== null &&
    options.reingest !== false;
  if (!pagingWasPrevented) return { outcome: 'reversed', incidentId: null };

  const alert = await prisma.alert.findUnique({
    where: { id: decision.alertId! },
    select: { payload: true, dedupKey: true, serviceId: true },
  });
  if (!alert) return { outcome: 'reversed', incidentId: null };
  const payload = (alert.payload ?? {}) as Record<string, unknown>;
  const severities = ['critical', 'error', 'warning', 'info'] as const;
  const severity = severities.find(level => level === payload.severity) ?? 'warning';
  try {
    const { processEvent } = await import('@/lib/events');
    const result = await processEvent(
      {
        event_action: 'trigger',
        dedup_key: `${alert.dedupKey ?? decision.id}:ungrouped:${decision.id}`,
        payload: {
          summary:
            typeof payload.summary === 'string'
              ? payload.summary
              : 'Alert released from noise control',
          source: typeof payload.source === 'string' ? payload.source : 'noise-controls',
          severity,
          custom_details: {
            ...(payload.custom_details && typeof payload.custom_details === 'object'
              ? (payload.custom_details as Record<string, unknown>)
              : {}),
            opsknight_noise_control_reversal: decision.id,
          },
        },
      },
      alert.serviceId,
      NOISE_CONTROL_REVERSAL_INTEGRATION_ID
    );
    const incidentId = 'incident' in result && result.incident ? result.incident.id : null;
    return { outcome: 'reversed', incidentId };
  } catch (error) {
    logger.warn('[Intelligence] Could not re-ingest a reversed noise decision', {
      decisionId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError({
      code: 'INTERNAL_ERROR',
      userMessage:
        'The decision was reversed, but the alert could not be re-ingested. Trigger it again from its source.',
    });
  }
}

/** Retention: decisions are operational history and age out with correlation data. */
export async function purgePrePagingDecisions(
  olderThan: Date,
  limit: number,
  client: Client = prisma
): Promise<number> {
  const rows = await client.prePagingDecision.findMany({
    where: { createdAt: { lt: olderThan } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  if (!rows.length) return 0;
  const deleted = await client.prePagingDecision.deleteMany({
    where: { id: { in: rows.map(r => r.id) } },
  });
  return deleted.count;
}
