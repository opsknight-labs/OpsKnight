import type { ComplianceEvaluation, ComplianceEvidence } from '@prisma/client';
import { verifyComplianceEvidenceHash } from '../evidence/hash';
import type {
  ComplianceObservation,
  ObservationFinding,
  ObservationEvidenceIntegrity,
} from './types';

/**
 * Builds a deterministic ComplianceObservation from a ComplianceEvaluation and its evidence.
 * Verifies canonical SHA-256 hash integrity for each evidence record.
 */
export function buildComplianceObservation(
  evaluation: Pick<
    ComplianceEvaluation,
    'id' | 'controlId' | 'status' | 'evaluatorId' | 'evaluatorVersion' | 'findings'
  >,
  evidence: readonly ComplianceEvidence[] = []
): ComplianceObservation {
  const findings: ObservationFinding[] = [];

  if (Array.isArray(evaluation.findings)) {
    for (const item of evaluation.findings) {
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (typeof record.code === 'string') {
          findings.push({
            code: record.code,
            severity: typeof record.severity === 'string' ? record.severity : 'INFO',
          });
        }
      }
    }
  }

  let mismatches = 0;
  for (const ev of evidence) {
    const isValid = verifyComplianceEvidenceHash({
      controlId: ev.controlId,
      evaluationId: ev.evaluationId,
      type: ev.type,
      collectorId: ev.collectorId,
      collectorVersion: ev.collectorVersion,
      title: ev.title,
      description: ev.description,
      resourceType: ev.resourceType,
      resourceId: ev.resourceId,
      observedAt: ev.observedAt,
      collectedAt: ev.collectedAt,
      validUntil: ev.validUntil,
      metadata: (ev.metadata ?? {}) as Record<string, unknown>,
      contentHash: ev.contentHash,
    });
    if (!isValid) {
      mismatches++;
    }
  }

  const evidenceIntegrity: ObservationEvidenceIntegrity = {
    total: evidence.length,
    mismatches,
  };

  return {
    controlId: evaluation.controlId,
    status: evaluation.status,
    evaluatorId: evaluation.evaluatorId,
    evaluatorVersion: evaluation.evaluatorVersion,
    findings,
    evidenceIntegrity,
  };
}
