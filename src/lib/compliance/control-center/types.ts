import type {
  ComplianceControlOwner,
  ComplianceEvaluationStatus,
  ComplianceFramework,
  ControlStatus,
} from '../types';

export type ComplianceControlStatus = ComplianceEvaluationStatus;
import type {
  EvidenceExpectation,
  FrameworkControlRelationship,
  RequirementLifecycle,
} from '../framework-mappings/types';

export type ControlCenterAssessmentMode = 'RUNTIME' | 'REPOSITORY';

export interface ControlCenterFrameworkMappingItem {
  readonly framework: ComplianceFramework;
  readonly requirementId: string;
  readonly reference: string;
  readonly title: string;
  readonly lifecycle: RequirementLifecycle;
  readonly relationship: FrameworkControlRelationship;
  readonly evidenceExpectation: EvidenceExpectation;
}

export interface ControlCenterRuntimeStateView {
  readonly status: ComplianceControlStatus;
  readonly summary: string;
  readonly evaluatedAt: string;
  readonly validUntil: string | null;
  readonly evaluatorId: string | null;
  readonly evaluatorVersion: string | null;
  readonly isVersionCurrent: boolean;
}

export interface ControlCenterEvidenceSummary {
  readonly count: number;
  readonly latestObservedAt: string | null;
  readonly integrity: 'VERIFIED' | 'MISMATCH' | 'NONE';
  readonly latestDigest?: string;
}

export interface ComplianceControlCenterControl {
  readonly controlId: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly assessmentMode: ControlCenterAssessmentMode;
  readonly owner: ComplianceControlOwner;
  readonly legacyStatus: ControlStatus;
  readonly runtime?: ControlCenterRuntimeStateView;
  readonly evidence: ControlCenterEvidenceSummary;
  readonly frameworkMappings: readonly ControlCenterFrameworkMappingItem[];
  readonly gaps: readonly string[];
}

export type AttentionRequiredSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export type AttentionRequiredType =
  | 'ACTION_REQUIRED'
  | 'UNVERIFIED'
  | 'INTEGRITY_MISMATCH'
  | 'STALE_EVALUATION';

export interface AttentionRequiredItem {
  readonly id: string;
  readonly controlId: string;
  readonly controlTitle: string;
  readonly severity: AttentionRequiredSeverity;
  readonly type: AttentionRequiredType;
  readonly reason: string;
  readonly evaluatedAt?: string;
  readonly actionLabel: string;
  readonly actionType: 'EVALUATE' | 'VIEW_EVIDENCE' | 'VIEW_OPERATIONS';
}

export interface ComplianceControlCenterOverview {
  readonly generatedAt: string;
  readonly runtime: {
    readonly total: number;
    readonly implemented: number;
    readonly partial: number;
    readonly actionRequired: number;
    readonly unverified: number;
  };
  readonly evidence: {
    readonly records: number;
    readonly verifiedRecords: number;
    readonly integrityMismatches: number;
  };
  readonly frameworks: {
    readonly count: number;
    readonly activeRequirements: number;
    readonly futureRequirements: number;
    readonly supersededRequirements: number;
  };
  readonly attention: readonly AttentionRequiredItem[];
  readonly controls: readonly ComplianceControlCenterControl[];
}
