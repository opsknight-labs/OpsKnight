import type { ComplianceFramework, ComplianceControlOwner } from '../types';

export type ComplianceFrameworkType = 'LAW' | 'REGULATION' | 'STANDARD' | 'ATTESTATION_CRITERIA';

export interface ComplianceFrameworkDefinition {
  readonly id: ComplianceFramework;
  readonly title: string;
  readonly version: string;
  readonly jurisdiction?: string;
  readonly frameworkType: ComplianceFrameworkType;
  readonly authoritativeSource: string;
  readonly sourceUrl: string;
  readonly effectiveFrom?: string;
  readonly notes?: string;
}

export type RequirementLifecycle = 'ACTIVE' | 'FUTURE' | 'SUPERSEDED' | 'REFERENCE_ONLY';

export type RequirementApplicability = 'PRODUCT' | 'OPERATOR' | 'ORGANIZATION' | 'SHARED';

export interface FrameworkRequirement {
  readonly id: string;
  readonly framework: ComplianceFramework;
  readonly reference: string;
  readonly title: string;
  readonly summary: string;
  readonly sourceUrl: string;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly lifecycle: RequirementLifecycle;
  readonly applicability: RequirementApplicability;
}

export type FrameworkControlRelationship =
  | 'TECHNICAL_EVIDENCE'
  | 'PROCESS_SUPPORT'
  | 'OPERATOR_DEPENDENCY'
  | 'ORGANIZATIONAL_DEPENDENCY';

export type EvidenceExpectation = 'RUNTIME' | 'REPOSITORY' | 'OPERATOR' | 'ORGANIZATIONAL';

export interface FrameworkControlMapping {
  readonly id: string;
  readonly framework: ComplianceFramework;
  readonly requirementId: string;
  readonly controlId: string;
  readonly relationship: FrameworkControlRelationship;
  readonly evidenceExpectation: EvidenceExpectation;
  readonly rationale: string;
  readonly notes?: string;
}

export interface FrameworkSummaryView {
  readonly framework: ComplianceFrameworkDefinition;
  readonly mappedRequirementsCount: number;
  readonly mappedControlsCount: number;
  readonly runtimeBackedCount: number;
  readonly repositoryBackedCount: number;
  readonly operatorDependencyCount: number;
  readonly organizationalDependencyCount: number;
  readonly futureRequirementsCount: number;
}

export interface FrameworkRequirementView {
  readonly requirement: FrameworkRequirement;
  readonly resolvedLifecycle: RequirementLifecycle;
  readonly mappings: readonly {
    readonly mappingId: string;
    readonly controlId: string;
    readonly controlTitle: string;
    readonly relationship: FrameworkControlRelationship;
    readonly evidenceExpectation: EvidenceExpectation;
    readonly rationale: string;
    readonly owner: ComplianceControlOwner;
    readonly assessmentMode: string;
    readonly runtimeState?: {
      readonly status: string;
      readonly summary: string;
      readonly evaluatedAt: string;
      readonly validUntil?: string | null;
    };
    readonly evidenceSummary?: {
      readonly latestObservedAt: string;
      readonly recordCount: number;
      readonly integrityValid: boolean;
      readonly latestDigest?: string;
    };
  }[];
}
