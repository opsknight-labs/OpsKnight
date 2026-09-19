import { createHash } from 'crypto';
import { toCanonicalJson } from './canonicalize';
import type { ComplianceEvidenceDraft, ComplianceEvidenceRecord } from './types';

export const EVIDENCE_SCHEMA_VERSION = '1';

export interface EvidenceHashPayload {
  readonly schemaVersion: string;
  readonly controlId: string;
  readonly evaluationId: string;
  readonly type: string;
  readonly collectorId: string;
  readonly collectorVersion: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly observedAt: string;
  readonly validUntil: string | null;
  readonly metadata: Record<string, unknown>;
}

export function buildEvidenceHashPayload(params: {
  controlId: string;
  evaluationId: string;
  type: string;
  collectorId: string;
  collectorVersion: string;
  resourceType?: string | null;
  resourceId?: string | null;
  observedAt: Date | string;
  validUntil?: Date | string | null;
  metadata: Record<string, unknown>;
}): EvidenceHashPayload {
  const observedAtStr =
    params.observedAt instanceof Date ? params.observedAt.toISOString() : params.observedAt;
  const validUntilStr = params.validUntil
    ? params.validUntil instanceof Date
      ? params.validUntil.toISOString()
      : params.validUntil
    : null;

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    controlId: params.controlId,
    evaluationId: params.evaluationId,
    type: params.type,
    collectorId: params.collectorId,
    collectorVersion: params.collectorVersion,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId ?? null,
    observedAt: observedAtStr,
    validUntil: validUntilStr,
    metadata: params.metadata,
  };
}

/**
 * Computes deterministic SHA-256 hash formatted as "sha256:<hex>" for an evidence draft.
 */
export function computeEvidenceContentHash(params: {
  controlId: string;
  evaluationId: string;
  draft: ComplianceEvidenceDraft;
}): string {
  const payload = buildEvidenceHashPayload({
    controlId: params.controlId,
    evaluationId: params.evaluationId,
    type: params.draft.type,
    collectorId: params.draft.collectorId,
    collectorVersion: params.draft.collectorVersion,
    resourceType: params.draft.resourceType,
    resourceId: params.draft.resourceId,
    observedAt: params.draft.observedAt,
    validUntil: params.draft.validUntil,
    metadata: params.draft.metadata,
  });

  const canonicalJson = toCanonicalJson(payload);
  const hash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Verifies that a stored ComplianceEvidence record's contentHash matches the recomputed hash.
 */
export function verifyComplianceEvidenceHash(
  evidence: Pick<
    ComplianceEvidenceRecord,
    | 'controlId'
    | 'evaluationId'
    | 'type'
    | 'collectorId'
    | 'collectorVersion'
    | 'resourceType'
    | 'resourceId'
    | 'observedAt'
    | 'validUntil'
    | 'metadata'
    | 'contentHash'
  >
): boolean {
  const payload = buildEvidenceHashPayload({
    controlId: evidence.controlId,
    evaluationId: evidence.evaluationId,
    type: evidence.type,
    collectorId: evidence.collectorId,
    collectorVersion: evidence.collectorVersion,
    resourceType: evidence.resourceType,
    resourceId: evidence.resourceId,
    observedAt: evidence.observedAt,
    validUntil: evidence.validUntil,
    metadata: evidence.metadata as Record<string, unknown>,
  });

  const canonicalJson = toCanonicalJson(payload);
  const expectedHash = `sha256:${createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}`;
  return expectedHash === evidence.contentHash;
}
