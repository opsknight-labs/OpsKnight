import type { ComplianceEvidenceDraft } from './types';

/**
 * Creates a validated evidence draft object with defaults.
 */
export function createEvidenceDraft(draft: ComplianceEvidenceDraft): ComplianceEvidenceDraft {
  return {
    type: draft.type,
    collectorId: draft.collectorId,
    collectorVersion: draft.collectorVersion,
    title: draft.title,
    description: draft.description ?? null,
    resourceType: draft.resourceType ?? null,
    resourceId: draft.resourceId ?? null,
    observedAt: draft.observedAt,
    validUntil: draft.validUntil ?? null,
    metadata: draft.metadata,
  };
}
