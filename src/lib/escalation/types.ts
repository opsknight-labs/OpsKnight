/**
 * Escalation domain types.
 *
 * Machine behaviour switches on `EscalationOutcome`. Human-readable `reason`
 * strings are telemetry only: nothing in the engine, the job queue, or the
 * trigger router may parse them to decide what happens next.
 */

export const ESCALATION_OUTCOMES = [
  /** A step ran: an audience was resolved and its pages were dispatched. */
  'STEP_EXECUTED',
  /** Nothing to page yet; a later step (or the first delay) is durably scheduled. */
  'STEP_SCHEDULED',
  /** The policy finished, or a lifecycle transition already stopped escalation. */
  'COMPLETED',
  /** A lifecycle transition paused escalation (snooze/suppress). */
  'PAUSED',
  /** A newer escalation generation invalidated this worker before it committed. */
  'SUPERSEDED',
  /** Another worker owns this generation + step right now. */
  'ALREADY_CLAIMED',
  /** The incident row no longer exists. */
  'NO_INCIDENT',
  /** The incident's service has no escalation policy with steps. */
  'NO_POLICY',
  /** The step this job was created for no longer exists in the live policy. */
  'STEP_MISSING',
  /** Terminal: the final step's target configuration is unusable. */
  'INVALID_TARGET',
  /** Terminal: the final step's target resolved to no eligible responders. */
  'NO_ELIGIBLE_RESPONDERS',
  /** Infrastructure failure. Escalation state was not advanced; retry it. */
  'RETRYABLE_FAILURE',
  /** Non-retryable engine failure. Escalation was parked in a terminal state. */
  'TERMINAL_FAILURE',
] as const;

export type EscalationOutcome = (typeof ESCALATION_OUTCOMES)[number];

export interface EscalationExecutionResult {
  outcome: EscalationOutcome;
  /**
   * True only for `STEP_EXECUTED`. Retained because dashboards, the cron
   * summary, and existing callers count "did a step actually page anyone".
   */
  escalated: boolean;
  /** Telemetry only. Never branch on this. */
  reason?: string;
  nextEscalationAt?: Date;
  targetName?: string;
  targetType?: string;
  targetCount?: number;
  stepIndex?: number;
  notifications?: unknown[];
  nextStepScheduled?: boolean;
}

/**
 * Outcomes whose escalation state is already durably persisted by the engine.
 * Fallback scanners must not overwrite these with a generic retry schedule.
 */
const AUTHORITATIVE_STATE: ReadonlySet<EscalationOutcome> = new Set([
  'STEP_EXECUTED',
  'STEP_SCHEDULED',
  'COMPLETED',
  'PAUSED',
  'SUPERSEDED',
  'ALREADY_CLAIMED',
  'NO_INCIDENT',
  'NO_POLICY',
  'STEP_MISSING',
  'INVALID_TARGET',
  'NO_ELIGIBLE_RESPONDERS',
  'TERMINAL_FAILURE',
]);

/**
 * Outcomes for which the escalation policy owns responder routing, so the
 * incident trigger must not also fan out the default responder notification.
 */
const POLICY_OWNS_RESPONDER_ROUTING: ReadonlySet<EscalationOutcome> = new Set([
  'STEP_EXECUTED',
  'STEP_SCHEDULED',
  'COMPLETED',
  'PAUSED',
  'SUPERSEDED',
  'ALREADY_CLAIMED',
]);

/**
 * True when the escalation engine reached a durable conclusion for this job,
 * so the job row may be closed. Only genuinely retryable infrastructure
 * failures leave a job open for another attempt.
 */
export function escalationJobIsSettled(outcome: EscalationOutcome): boolean {
  return outcome !== 'RETRYABLE_FAILURE';
}

/** True when the engine already persisted authoritative escalation state. */
export function escalationStateIsAuthoritative(outcome: EscalationOutcome): boolean {
  return AUTHORITATIVE_STATE.has(outcome);
}

/** True when the escalation policy — not the default fan-out — pages responders. */
export function escalationPolicyOwnsResponderRouting(outcome: EscalationOutcome): boolean {
  return POLICY_OWNS_RESPONDER_ROUTING.has(outcome);
}

/** Classifies a thrown engine error into a retryable or terminal outcome. */
export function escalationOutcomeForError(error: unknown): EscalationOutcome {
  if (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    error.retryable === true
  ) {
    return 'RETRYABLE_FAILURE';
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (
    code === 'P2034' ||
    code === 'P2028' ||
    code === 'P2002' ||
    ['P1001', 'P1002', 'P1008', 'P1017'].includes(code)
  ) {
    return 'RETRYABLE_FAILURE';
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const retryable =
    /Serialization|deadlock|write conflict|Connection|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout/i.test(
      message
    );
  return retryable ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE';
}
