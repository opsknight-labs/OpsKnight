import type { ComplianceEvidenceType as PrismaComplianceEvidenceType } from '@prisma/client';

export type ComplianceEvidenceType = PrismaComplianceEvidenceType;

export const COMPLIANCE_EVIDENCE_TYPES = [
  'VERIFICATION_RESULT',
  'CONFIGURATION_SNAPSHOT',
  'SYSTEM_STATE',
  'CAPABILITY_CHECK',
  'EXECUTION_SUMMARY',
  'EVALUATION_FAILURE',
] as const;

export interface ComplianceEvidenceDraft {
  readonly type: ComplianceEvidenceType;
  readonly collectorId: string;
  readonly collectorVersion: string;
  readonly title: string;
  readonly description?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly observedAt: Date;
  readonly validUntil?: Date | null;
  readonly metadata: Record<string, unknown>;
}

export interface ComplianceEvidenceRecord {
  readonly id: string;
  readonly evaluationId: string;
  readonly controlId: string;
  readonly type: ComplianceEvidenceType;
  readonly collectorId: string;
  readonly collectorVersion: string;
  readonly title: string;
  readonly description?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly observedAt: Date;
  readonly collectedAt: Date;
  readonly validUntil?: Date | null;
  readonly contentHash: string;
  readonly metadata: Record<string, unknown>;
}

export interface EvidenceQueryOptions {
  readonly controlId?: string;
  readonly evaluationId?: string;
  readonly type?: ComplianceEvidenceType;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface EvidenceQueryResult {
  readonly evidence: readonly ComplianceEvidenceRecord[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
