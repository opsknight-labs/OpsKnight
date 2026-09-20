import type { IncidentResolutionKind, IncidentStatus } from '@prisma/client';

/** Database-shaped input; transport adapters must parse dates before projecting. */
export interface IncidentSlaProjectionInput {
  status: IncidentStatus;
  createdAt: Date;
  acknowledgedAt: Date | null;
  /** Immutable lifetime first acknowledgement; legacy inputs may omit it. */
  slaFirstAcknowledgedAt?: Date | null;
  resolvedAt: Date | null;
  resolutionKind?: IncidentResolutionKind | null;
  slaAckTargetMs: number | null;
  slaResolveTargetMs: number | null;
  slaTargetSource: string | null;
  slaTargetCapturedAt: Date | null;
  slaPausedMs: bigint | number;
  slaPauseStartedAt: Date | null;
  slaAckElapsedMs: bigint | number | null;
  slaResolveElapsedMs: bigint | number | null;
  slaPolicyId?: string | null;
  slaPolicyVersion?: number | null;
  slaPolicyRule?: string | null;
  slaPriorityAtCapture?: string | null;
}

export interface IncidentSlaWarningPolicy {
  /** Fraction of the target remaining when the warning starts, from zero to one. */
  ratio: number;
  ackCeilingMs: number;
  resolveCeilingMs: number;
}

export interface IncidentSlaProjectionOptions {
  now?: Date;
  warningPolicy?: IncidentSlaWarningPolicy;
}

export interface IncidentSlaContract {
  ackTargetMs: number;
  resolveTargetMs: number;
  source: string;
  capturedAt: Date;
  policyId: string | null;
  policyVersion: number | null;
  policyRule: string | null;
  priorityAtCapture: string | null;
}

export interface IncidentSlaClock {
  evaluatedAt: Date;
  /** Closed pauses only, saturated to Number.MAX_SAFE_INTEGER like sla-clock. */
  pausedMs: number;
  pauseStartedAt: Date | null;
  paused: boolean;
}

export type IncidentSlaPhaseStatus = 'PENDING' | 'MET' | 'BREACHED' | 'NOT_REQUIRED';
export type IncidentSlaApplicability = 'REQUIRED' | 'NOT_REQUIRED';
export type IncidentSlaWarning = 'NONE' | 'APPROACHING' | 'BREACHED';
export type IncidentSlaPhase = 'ack' | 'resolve';

export interface IncidentSlaPhaseState {
  applicability: IncidentSlaApplicability;
  reason: string | null;
  targetMs: number;
  elapsedMs: number;
  /** Signed budget: negative values retain the amount overdue. */
  remainingMs: number;
  progress: number;
  status: IncidentSlaPhaseStatus;
  /** Actionable signal, not historical compliance; NONE when paused or completed. */
  warning: IncidentSlaWarning;
  completedAt: Date | null;
  /** Deadlines are unavailable while paused, completed, or not applicable. */
  warningAt: Date | null;
  /** First millisecond strictly over target, not the last compliant millisecond. */
  breachAt: Date | null;
}

export type IncidentSlaState =
  | {
      valid: false;
      contractState: 'INVALID';
      reason: string;
      contract: null;
      clock: IncidentSlaClock;
      ack: null;
      resolve: null;
    }
  | {
      valid: true;
      contractState: 'VALID';
      contract: IncidentSlaContract;
      clock: IncidentSlaClock;
      ack: IncidentSlaPhaseState;
      resolve: IncidentSlaPhaseState;
    };
