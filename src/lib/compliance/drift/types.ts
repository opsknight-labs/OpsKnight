import type {
  ComplianceEvaluationStatus,
  ComplianceDriftStatus,
  ComplianceDriftKind,
  ComplianceDriftImpact,
  ComplianceMonitoringRunStatus,
} from '@prisma/client';

export type {
  ComplianceEvaluationStatus,
  ComplianceDriftStatus,
  ComplianceDriftKind,
  ComplianceDriftImpact,
  ComplianceMonitoringRunStatus,
};

export interface ObservationFinding {
  readonly code: string;
  readonly severity: string;
}

export interface ObservationEvidenceIntegrity {
  readonly total: number;
  readonly mismatches: number;
}

export interface ComplianceObservation {
  readonly controlId: string;
  readonly status: ComplianceEvaluationStatus;
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly findings: readonly ObservationFinding[];
  readonly evidenceIntegrity: ObservationEvidenceIntegrity;
}

export interface ComplianceDetectedDrift {
  readonly kind: ComplianceDriftKind;
  readonly impact: ComplianceDriftImpact;
  readonly previousStatus?: ComplianceEvaluationStatus;
  readonly currentStatus?: ComplianceEvaluationStatus;
  readonly summary: string;
  readonly details: Record<string, unknown>;
  readonly isRecovery?: boolean;
  readonly recoveryKind?: ComplianceDriftKind;
}

export interface DriftEventFilterOptions {
  readonly status?: ComplianceDriftStatus | 'ALL';
  readonly kind?: ComplianceDriftKind;
  readonly impact?: ComplianceDriftImpact;
  readonly controlId?: string;
  readonly framework?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly cursor?: string;
  readonly limit?: number;
}
