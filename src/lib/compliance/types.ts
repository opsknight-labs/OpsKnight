/** Reviewed repository metadata, never a certification or a deployment assessment. */
export type ComplianceFramework =
  | 'CRA'
  | 'GDPR'
  | 'SOC2'
  | 'ISO27001'
  | 'ISO27701'
  | 'DPDP'
  | 'CCPA';

export type ControlStatus = 'IMPLEMENTED' | 'PARTIAL' | 'MISSING';

export type ComplianceEvaluationStatus =
  | 'IMPLEMENTED'
  | 'PARTIAL'
  | 'ACTION_REQUIRED'
  | 'UNVERIFIED'
  | 'NOT_APPLICABLE';

export type ComplianceEvaluationTrigger = 'MANUAL' | 'API' | 'SCHEDULED' | 'DEPLOYMENT';

export type ComplianceControlOwner = 'MAINTAINER' | 'OPERATOR' | 'ORGANIZATION' | 'SHARED';

export type ControlOwner = ComplianceControlOwner;

export type ComplianceAssessmentMode = 'RUNTIME' | 'CATALOG' | 'ATTESTATION' | 'MIXED';

export interface ControlFinding {
  readonly code: string;
  readonly message?: string;
  readonly value?: string | number | boolean | null;
  readonly severity?: 'INFO' | 'WARNING' | 'ERROR';
}

export interface ControlEvidenceReference {
  readonly source: string;
  readonly referenceId?: string;
  readonly description?: string;
}

export interface ComplianceControlDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly owner: ComplianceControlOwner;
  readonly frameworks: readonly ComplianceFramework[];
  readonly implementation: string;
  readonly gaps: readonly string[];
  readonly evidence: readonly string[];
  readonly evaluatorId?: string;
  readonly assessmentMode: ComplianceAssessmentMode;
  readonly catalogStatus?: ControlStatus;
  /** Backward compatibility: fallback to catalogStatus if queried as status */
  readonly status: ControlStatus;
}

export type ComplianceControl = ComplianceControlDefinition;

export interface ComplianceRuntimeControlState {
  readonly controlId: string;
  readonly status: ComplianceEvaluationStatus;
  readonly latestEvaluationId: string;
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly evaluatedAt: Date;
  readonly validUntil?: Date | null;
  readonly summary: string;
  readonly isVersionCurrent: boolean;
}
