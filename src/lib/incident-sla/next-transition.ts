import { projectIncidentSlaState } from './state';
import type { IncidentSlaProjectionInput } from './types';
import type { NewIncidentSlaContract } from './contract';
import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { incidentSlaSelect } from './select';
import { getIncidentSlaTransitions } from './deadlines';

/** Earliest transition for the scheduler; indexed hints are enabled independently during rollout. */
export async function getNextIncidentSlaTransitionAt(now = new Date()): Promise<Date | null> {
  if (process.env.INDEXED_SLA_SCHEDULER === 'true') {
    const row = await prisma.incident.findFirst({
      where: { status: { in: activeIncidentStatuses() }, nextSlaTransitionAt: { not: null } },
      orderBy: { nextSlaTransitionAt: 'asc' },
      select: { nextSlaTransitionAt: true },
    });
    return row?.nextSlaTransitionAt ?? null;
  }
  const incidents = await prisma.incident.findMany({
    where: { status: { in: activeIncidentStatuses() } },
    select: incidentSlaSelect,
  });
  let earliest: Date | null = null;
  for (const incident of incidents) {
    const candidate = getIncidentSlaTransitions(incident, { now }).nextTransitionAt;
    if (candidate && (!earliest || candidate < earliest)) earliest = candidate;
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
