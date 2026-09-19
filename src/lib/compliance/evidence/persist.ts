import type { Prisma } from '@prisma/client';
import type { ComplianceEvidenceDraft, ComplianceEvidenceRecord } from './types';
import { validateEvidenceDrafts } from './validate';
import { computeEvidenceContentHash } from './hash';

export interface PersistEvidenceDraftsOptions {
  readonly tx: Prisma.TransactionClient;
  readonly evaluationId: string;
  readonly controlId: string;
  readonly drafts: readonly ComplianceEvidenceDraft[];
  readonly collectedAt?: Date;
}

/**
 * Validates, hashes, and persists a collection of evidence drafts inside an active transaction.
 * Does not trust any caller-provided controlId, evaluationId, or contentHash.
 */
export async function persistEvidenceDrafts(
  options: PersistEvidenceDraftsOptions
): Promise<ComplianceEvidenceRecord[]> {
  const { tx, evaluationId, controlId, drafts, collectedAt = new Date() } = options;

  if (drafts.length === 0) {
    return [];
  }

  // Enforce safety validations (rejects forbidden keys, depth, oversized metadata, excess records)
  validateEvidenceDrafts(drafts);

  const recordsToCreate = drafts.map(draft => {
    const contentHash = computeEvidenceContentHash({
      controlId,
      evaluationId,
      draft,
    });

    return {
      evaluationId,
      controlId,
      type: draft.type,
      collectorId: draft.collectorId,
      collectorVersion: draft.collectorVersion,
      title: draft.title,
      description: draft.description ?? null,
      resourceType: draft.resourceType ?? null,
      resourceId: draft.resourceId ?? null,
      observedAt: draft.observedAt,
      collectedAt,
      validUntil: draft.validUntil ?? null,
      contentHash,
      metadata: draft.metadata as Prisma.InputJsonValue,
    };
  });

  const createdRecords: ComplianceEvidenceRecord[] = [];
  for (const item of recordsToCreate) {
    const row = await tx.complianceEvidence.create({
      data: item,
    });
    createdRecords.push({
      id: row.id,
      evaluationId: row.evaluationId,
      controlId: row.controlId,
      type: row.type,
      collectorId: row.collectorId,
      collectorVersion: row.collectorVersion,
      title: row.title,
      description: row.description,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      observedAt: row.observedAt,
      collectedAt: row.collectedAt,
      validUntil: row.validUntil,
      contentHash: row.contentHash,
      metadata: row.metadata as Record<string, unknown>,
    });
  }

  return createdRecords;
}
