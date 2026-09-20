import type {
  ComplianceFramework,
  ComplianceAssessmentMode,
  ComplianceControlOwner,
  ComplianceEvaluationStatus,
  ControlFinding,
} from '../types';
import type {
  RequirementLifecycle,
  FrameworkControlRelationship,
} from '../framework-mappings/types';

export type EvidencePackageScopeType = 'DEPLOYMENT' | 'FRAMEWORK' | 'CONTROLS';

export type EvidencePackageScope =
  | { readonly type: 'DEPLOYMENT' }
  | {
      readonly type: 'FRAMEWORK';
      readonly framework: ComplianceFramework;
    }
  | {
      readonly type: 'CONTROLS';
      readonly controlIds: readonly string[];
    };

export type EvidenceSelectionMode = 'SNAPSHOT' | 'HISTORICAL';

export type EvidenceSelection =
  | { readonly mode: 'SNAPSHOT' }
  | {
      readonly mode: 'HISTORICAL';
      readonly from: string;
      readonly to: string;
    };

export interface EvidencePackageFileEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface EvidencePackageManifest {
  readonly schemaVersion: '1';
  readonly packageId: string;
  readonly generatedAt: string;
  readonly snapshotAt: string;
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly product: {
    readonly name: 'OpsKnight';
    readonly version: string;
    readonly buildId?: string;
  };
  readonly fingerprints: {
    readonly controlRegistry: string;
    readonly frameworkMappings: string;
  };
  readonly frameworks: ReadonlyArray<{
    readonly id: ComplianceFramework;
    readonly version: string;
  }>;
  readonly counts: {
    readonly controls: number;
    readonly requirements: number;
    readonly evidence: number;
    readonly integrityMismatches: number;
  };
  readonly files: readonly EvidencePackageFileEntry[];
  readonly generatedBy: {
    readonly userId: string;
  };
}

export interface ExportedControlSnapshot {
  readonly controlId: string;
  readonly title: string;
  readonly assessmentMode: ComplianceAssessmentMode;
  readonly owner: ComplianceControlOwner;
  readonly resolvedCurrentState: ComplianceEvaluationStatus | null;
  readonly summary?: string | null;
  readonly evaluatedAt?: string | null;
  readonly validUntil?: string | null;
  readonly evaluator?: {
    readonly id: string;
    readonly version: string;
  } | null;
  readonly evidenceCount: number;
  readonly frameworkMappings: ReadonlyArray<{
    readonly framework: ComplianceFramework;
    readonly requirementId: string;
    readonly reference: string;
    readonly lifecycle: RequirementLifecycle;
    readonly relationship: FrameworkControlRelationship;
    readonly evidenceExpectation: string;
    readonly rationale?: string;
    readonly notes?: string;
  }>;
  readonly gaps: readonly string[];
  readonly implementation: string;
  readonly evidencePaths: readonly string[];
}

export interface ExportedEvaluationSnapshot {
  readonly evaluationId: string;
  readonly controlId: string;
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly status: ComplianceEvaluationStatus;
  readonly summary: string | null;
  readonly evaluatedAt: string;
  readonly validUntil: string | null;
  readonly findings: readonly ControlFinding[];
}

export interface ExportedEvidenceRecord {
  readonly id: string;
  readonly evaluationId: string;
  readonly controlId: string;
  readonly type: string;
  readonly collectorId: string;
  readonly collectorVersion: string;
  readonly title: string;
  readonly description: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly observedAt: string;
  readonly collectedAt: string;
  readonly validUntil: string | null;
  readonly metadata: Record<string, unknown>;
  readonly contentHash: string;
  readonly integrityValid: boolean;
}

export interface ExportedFrameworkDefinition {
  readonly id: ComplianceFramework;
  readonly title: string;
  readonly version: string;
  readonly jurisdiction?: string | null;
  readonly frameworkType: string;
  readonly authoritativeSource: string;
  readonly sourceUrl: string;
  readonly notes: string | null;
}

export interface ExportedFrameworkRequirement {
  readonly requirementId: string;
  readonly framework: ComplianceFramework;
  readonly reference: string;
  readonly title: string;
  readonly summary: string;
  readonly sourceUrl: string;
  readonly lifecycle: RequirementLifecycle;
  readonly applicability: string;
  readonly effectiveFrom?: string | null;
  readonly effectiveUntil?: string | null;
  readonly mappedControls: ReadonlyArray<{
    readonly controlId: string;
    readonly relationship: FrameworkControlRelationship;
  }>;
  readonly operatorAssessmentRequired: boolean;
}

export interface ExportPackagePreview {
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly snapshotAt: string;
  readonly counts: {
    readonly controls: number;
    readonly requirements: number;
    readonly evidence: number;
  };
  readonly estimatedSizeBytes: number;
}

export interface PackageVerificationMismatch {
  readonly path: string;
  readonly reason: 'MISSING' | 'HASH_MISMATCH' | 'SIZE_MISMATCH' | 'UNLISTED_FILE';
  readonly expectedHash?: string;
  readonly actualHash?: string;
  readonly expectedSize?: number;
  readonly actualSize?: number;
}

export interface PackageVerificationResult {
  readonly valid: boolean;
  readonly packageId: string;
  readonly manifestValid: boolean;
  readonly entriesTotal: number;
  readonly entriesVerified: number;
  readonly mismatches: readonly PackageVerificationMismatch[];
  readonly warnings: readonly string[];
}
