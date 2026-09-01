/**
 * Pure escalation state-machine rules. No Prisma, no clock, no I/O.
 *
 * Everything here is a function of values the caller already loaded, so the
 * transition rules can be tested exhaustively without a database.
 */

/**
 * Persisted escalation execution states. These are the string values already
 * stored in `Incident.escalationStatus`; promoting them to a database enum is
 * a separate migration.
 */
export const ESCALATION_STATUSES = ['ESCALATING', 'PAUSED', 'COMPLETED', 'FAILED'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/** What the incident's lifecycle currently permits escalation to do. */
export type EscalationLifecycleGate = 'ACTIVE' | 'STOPPED' | 'PAUSED';

export interface EscalationLifecycleSnapshot {
  status: string;
  escalationStatus?: string | null;
}

/**
 * ACK and RESOLVE stop escalation for good; SNOOZE and SUPPRESS pause it. A
 * worker that resolved its audience before one of these landed must respect
 * the newer lifecycle state rather than re-arm the incident as ESCALATING.
 */
export function escalationLifecycleGate(
  incident: EscalationLifecycleSnapshot
): EscalationLifecycleGate {
  if (
    incident.status === 'ACKNOWLEDGED' ||
    incident.status === 'RESOLVED' ||
    incident.escalationStatus === 'COMPLETED'
  ) {
    return 'STOPPED';
  }
  if (
    incident.status === 'SNOOZED' ||
    incident.status === 'SUPPRESSED' ||
    incident.escalationStatus === 'PAUSED'
  ) {
    return 'PAUSED';
  }
  return 'ACTIVE';
}

/**
 * The step that follows `stepIndex`, or `null` when the policy is exhausted.
 *
 * Policies do not repeat. A completed policy is COMPLETED; it must never be
 * rewound to step 0. Repeat behaviour, if it is ever wanted, belongs in
 * explicit persisted policy fields, not in an inferred cycle count.
 */
export function nextEscalationStepIndex(stepIndex: number, stepCount: number): number | null {
  const next = stepIndex + 1;
  return next < stepCount ? next : null;
}

/** True once the step cursor has run past the end of the policy. */
export function escalationPolicyExhausted(stepIndex: number, stepCount: number): boolean {
  return stepIndex >= stepCount;
}

/** When a step with `delayMinutes` of lead time becomes due. */
export function escalationDueAt(now: Date, delayMinutes: number | null | undefined): Date {
  return new Date(now.getTime() + Math.max(delayMinutes ?? 0, 0) * 60 * 1000);
}

/**
 * Terminal escalation state records why routing stopped: FAILED means no
 * responder could be reached, COMPLETED means the policy ran its course.
 */
export function terminalEscalationStatus(reachedResponders: boolean): EscalationStatus {
  return reachedResponders ? 'COMPLETED' : 'FAILED';
}
