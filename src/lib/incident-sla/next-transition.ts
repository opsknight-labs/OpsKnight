import { projectIncidentSlaState } from './state';
import type { IncidentSlaProjectionInput } from './types';
import type { NewIncidentSlaContract } from './contract';
import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { incidentSlaSelect } from './select';
import { getIncidentSlaTransitions } from './deadlines';
import { getSlaSchedulerMode } from './scheduler-control';
import { addOperationalMetric, setOperationalGauge } from '@/lib/metrics/operational/registry';

/** Earliest transition for the scheduler; indexed hints are enabled independently during rollout. */
export async function getNextIncidentSlaTransitionAt(now = new Date()): Promise<Date | null> {
  const schedulerMode = await getSlaSchedulerMode();
  const eligible = {
    status: { in: activeIncidentStatuses() },
    service: { serviceNotifyOnSlaBreach: true },
  };
  if (schedulerMode === 'INDEXED') {
    const row = await prisma.incident.findFirst({
      where: { ...eligible, nextSlaTransitionAt: { not: null } },
      orderBy: { nextSlaTransitionAt: 'asc' },
      select: { nextSlaTransitionAt: true },
    });
    return row?.nextSlaTransitionAt ?? null;
  }
  const incidents = await prisma.incident.findMany({
    where: eligible,
    select: incidentSlaSelect,
  });
  let earliest: Date | null = null;
  for (const incident of incidents) {
    const candidate = getIncidentSlaTransitions(incident, { now }).nextTransitionAt;
    if (candidate && (!earliest || candidate < earliest)) earliest = candidate;
  }
  if (schedulerMode === 'SHADOW') {
    const [indexed, nullHints, due] = await Promise.all([
      prisma.incident.findFirst({
        where: { ...eligible, nextSlaTransitionAt: { not: null } },
        orderBy: { nextSlaTransitionAt: 'asc' },
        select: { nextSlaTransitionAt: true },
      }),
      prisma.incident.count({
        where: { ...eligible, nextSlaTransitionAt: null },
      }),
      prisma.incident.count({
        where: { ...eligible, nextSlaTransitionAt: { lte: now } },
      }),
    ]);
    setOperationalGauge('opsknight_sla_scheduler_null_hints', nullHints);
    setOperationalGauge('opsknight_sla_scheduler_due', due);
    const indexedAt = indexed?.nextSlaTransitionAt ?? null;
    if (indexedAt?.getTime() !== earliest?.getTime())
      addOperationalMetric('opsknight_sla_scheduler_shadow_mismatch_total', 1, {
        reason: indexedAt ? 'different_transition' : 'missing_hint',
      });
  }
  return earliest;
}

export type NextSlaTransitionKind =
  | 'ACK_WARNING'
  | 'ACK_BREACH'
  | 'RESOLVE_WARNING'
  | 'RESOLVE_BREACH';
export type NextSlaTransition = { at: Date; kind: NextSlaTransitionKind } | null;

/** Derives scheduling hints only from the canonical projector. */
export function deriveNextSlaTransition(
  input: IncidentSlaProjectionInput,
  now = new Date()
): NextSlaTransition {
  const state = projectIncidentSlaState(input, { now });
  if (!state.valid || state.clock.paused) return null;
  const candidates: Array<{ at: Date; kind: NextSlaTransitionKind }> = [];
  for (const [name, phase] of [
    ['ACK', state.ack],
    ['RESOLVE', state.resolve],
  ] as const) {
    if (phase.status !== 'PENDING') continue;
    if (phase.warning === 'NONE' && phase.warningAt && phase.warningAt > now)
      candidates.push({ at: phase.warningAt, kind: `${name}_WARNING` });
    else if (phase.breachAt && phase.breachAt > now)
      candidates.push({ at: phase.breachAt, kind: `${name}_BREACH` });
  }
  return candidates.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

export function deriveNewIncidentSlaTransition(
  contract: NewIncidentSlaContract,
  createdAt: Date
): NextSlaTransition {
  return deriveNextSlaTransition(
    {
      status: 'OPEN',
      createdAt,
      acknowledgedAt: null,
      resolvedAt: null,
      slaPausedMs: 0,
      slaPauseStartedAt: null,
      slaAckElapsedMs: null,
      slaResolveElapsedMs: null,
      slaAckTargetMs: contract.ackTargetMs,
      slaResolveTargetMs: contract.resolveTargetMs,
      slaTargetSource: contract.source,
      slaTargetCapturedAt: contract.capturedAt,
      slaPolicyId: contract.policyId,
      slaPolicyVersion: contract.policyVersion,
      slaPolicyRule: contract.policyRule,
      slaPriorityAtCapture: null,
    },
    createdAt
  );
}
