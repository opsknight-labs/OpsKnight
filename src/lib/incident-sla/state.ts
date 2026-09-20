import {
  capturedOrEffectiveElapsedMs,
  effectiveMaterializedElapsedMs,
} from '@/lib/metrics/domain/sla-clock';
import type {
  IncidentSlaClock,
  IncidentSlaPhase,
  IncidentSlaPhaseState,
  IncidentSlaProjectionInput,
  IncidentSlaProjectionOptions,
  IncidentSlaState,
} from './types';
import {
  DEFAULT_SLA_WARNING_POLICY,
  getIncidentSlaWarningWindowMs,
  isValidIncidentSlaWarningPolicy,
} from './warning-policy';
import { validateCapturedIncidentSlaContract } from './contract';

export type * from './types';

function isDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isDuration(value: unknown): value is bigint | number {
  return typeof value === 'bigint'
    ? value >= BigInt(0)
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validationReason(input: IncidentSlaProjectionInput, now: Date): string | null {
  const contractReason = validateCapturedIncidentSlaContract(input);
  if (contractReason) return contractReason;
  if (!isDate(now)) return 'Invalid evaluation date';
  if (!isDate(input.createdAt)) return 'Invalid incident creation date';
  const dateValues: Array<[string, Date | null]> = [
    ['acknowledgedAt', input.acknowledgedAt],
    ['resolvedAt', input.resolvedAt],
    ['slaPauseStartedAt', input.slaPauseStartedAt],
  ];
  for (const [key, value] of dateValues) {
    if (value !== null && (!isDate(value) || value < input.createdAt)) return `Invalid ${key}`;
  }
  if (!isDuration(input.slaPausedMs)) return 'Invalid materialized pause duration';
  const elapsedValues: Array<[string, bigint | number | null]> = [
    ['slaAckElapsedMs', input.slaAckElapsedMs],
    ['slaResolveElapsedMs', input.slaResolveElapsedMs],
  ];
  for (const [key, value] of elapsedValues) {
    if (value !== null && !isDuration(value)) return `Invalid ${key}`;
  }
  if (!['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'].includes(input.status)) {
    return 'Invalid incident status';
  }
  if (input.status === 'RESOLVED' && input.resolvedAt === null) {
    return 'Resolved incident is missing its completion date';
  }
  if (input.status === 'ACKNOWLEDGED' && input.acknowledgedAt === null) {
    return 'Acknowledged incident is missing its completion date';
  }
  if (
    (input.status === 'SNOOZED' || input.status === 'SUPPRESSED') &&
    input.slaPauseStartedAt === null
  ) {
    return 'Paused incident is missing its canonical pause start';
  }
  return null;
}

/**
 * Project only the incident's captured contract, never current service/priority defaults.
 * Pass `now` for deterministic evaluation. There is no I/O, logging, or input mutation.
 * Invalid rows are explicit; the caller owns logging and repair, not this projector.
 */
export function projectIncidentSlaState(
  input: IncidentSlaProjectionInput,
  options: IncidentSlaProjectionOptions = {}
): IncidentSlaState {
  const now = options.now ?? new Date();
  const policy = options.warningPolicy ?? DEFAULT_SLA_WARNING_POLICY;
  const clock: IncidentSlaClock = {
    evaluatedAt: now,
    pausedMs: isDuration(input.slaPausedMs)
      ? capturedOrEffectiveElapsedMs({
          capturedElapsedMs: input.slaPausedMs,
          startedAt: now,
          evaluationAt: now,
        })
      : 0,
    pauseStartedAt: isDate(input.slaPauseStartedAt) ? input.slaPauseStartedAt : null,
    paused: isDate(input.slaPauseStartedAt),
  };
  const reason =
    validationReason(input, now) ??
    (isValidIncidentSlaWarningPolicy(policy) ? null : 'Invalid SLA warning policy');
  if (reason !== null) {
    return {
      valid: false,
      contractState: 'INVALID',
      reason,
      contract: null,
      clock,
      ack: null,
      resolve: null,
    };
  }

  // Validation above narrows the runtime contract; no target resolver is involved.
  const contract = {
    ackTargetMs: input.slaAckTargetMs!,
    resolveTargetMs: input.slaResolveTargetMs!,
    source: input.slaTargetSource!,
    capturedAt: input.slaTargetCapturedAt!,
    policyId: input.slaPolicyId ?? null,
    policyVersion: input.slaPolicyVersion ?? null,
    policyRule: input.slaPolicyRule ?? null,
    priorityAtCapture: input.slaPriorityAtCapture ?? null,
  };

  function projectPhase(phase: IncidentSlaPhase): IncidentSlaPhaseState {
    const targetMs = phase === 'ack' ? contract.ackTargetMs : contract.resolveTargetMs;
    const completedAt = phase === 'ack' ? input.acknowledgedAt : input.resolvedAt;
    const resolvedWithoutAck =
      phase === 'ack' && input.status === 'RESOLVED' && input.acknowledgedAt === null;
    const capturedElapsedMs = phase === 'ack' ? input.slaAckElapsedMs : input.slaResolveElapsedMs;
    const evaluationAt = completedAt ?? (resolvedWithoutAck ? input.resolvedAt! : now);
    // Captures protect completed ACK from later pauses. Legacy rows use the existing
    // materialized clock; this API does not invent pause history it was not given.
    const elapsedMs =
      completedAt !== null && capturedElapsedMs !== null
        ? capturedOrEffectiveElapsedMs({
            capturedElapsedMs,
            startedAt: input.createdAt,
            evaluationAt,
          })
        : effectiveMaterializedElapsedMs({
            startedAt: input.createdAt,
            evaluationAt,
            pausedMs: input.slaPausedMs,
            pauseStartedAt: input.slaPauseStartedAt,
          });
    const remainingMs = targetMs - elapsedMs;
    const sourceRecoveredBeforeAck =
      resolvedWithoutAck && input.resolutionKind === 'SOURCE_RECOVERY' && elapsedMs <= targetMs;
    const status = sourceRecoveredBeforeAck
      ? 'NOT_REQUIRED'
      : resolvedWithoutAck
        ? 'BREACHED'
        : elapsedMs > targetMs
          ? 'BREACHED'
          : completedAt !== null
            ? 'MET'
            : 'PENDING';
    const actionable = !resolvedWithoutAck && completedAt === null && !clock.paused;
    const windowMs = getIncidentSlaWarningWindowMs(phase, targetMs, policy);
    // With no open pause, the deadline is creation + closed pauses + target.
    // The first noncompliant Date is one millisecond after that deadline.
    const targetAtMs = input.createdAt.getTime() + clock.pausedMs + targetMs;
    const warningAt = actionable ? new Date(targetAtMs - windowMs) : null;
    const breachAt = actionable ? new Date(targetAtMs + 1) : null;
    return {
      applicability: sourceRecoveredBeforeAck ? 'NOT_REQUIRED' : 'REQUIRED',
      reason: sourceRecoveredBeforeAck
        ? 'Source recovered before the acknowledgement deadline'
        : null,
      targetMs,
      elapsedMs,
      remainingMs,
      progress: Math.min(1, Math.max(0, elapsedMs / targetMs)),
      status,
      warning: !actionable
        ? 'NONE'
        : elapsedMs > targetMs
          ? 'BREACHED'
          : remainingMs <= windowMs
            ? 'APPROACHING'
            : 'NONE',
      completedAt,
      warningAt: warningAt !== null && isDate(warningAt) ? warningAt : null,
      breachAt: breachAt !== null && isDate(breachAt) ? breachAt : null,
    };
  }

  return {
    valid: true,
    contractState: 'VALID',
    contract,
    clock,
    ack: projectPhase('ack'),
    resolve: projectPhase('resolve'),
  };
}
