import type { PrismaClient } from '@prisma/client';
import type {
  ComplianceEvaluationStatus,
  ControlFinding,
  ControlEvidenceReference,
} from '../types';
import type { ComplianceEvidenceDraft } from '../evidence/types';

export interface ComplianceEvaluationActor {
  readonly id: string;
  readonly email?: string | null;
  readonly name?: string | null;
}

export interface ComplianceEvaluationContext {
  readonly prisma: PrismaClient;
  readonly now: Date;
  readonly controlRegistryFingerprint: string;
  readonly actor?: ComplianceEvaluationActor | null;
}

export interface ComplianceEvaluatorResult {
  readonly status: ComplianceEvaluationStatus;
  readonly summary: string;
  readonly findings: readonly ControlFinding[];
  readonly evidence: readonly ComplianceEvidenceDraft[];
  readonly evidenceRefs?: readonly ControlEvidenceReference[];
  readonly validUntil?: Date | null;
}

export interface ComplianceControlEvaluator {
  readonly id: string;
  readonly version: string;
  evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult>;
}
