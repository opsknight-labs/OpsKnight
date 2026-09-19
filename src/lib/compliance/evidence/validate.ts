import type { ComplianceEvidenceDraft } from './types';

export class EvidenceValidationError extends Error {
  constructor(
    message: string,
    readonly code: string = 'EVIDENCE_VALIDATION_FAILED'
  ) {
    super(message);
    this.name = 'EvidenceValidationError';
  }
}

export const MAX_METADATA_BYTES = 32 * 1024; // 32 KB
export const MAX_STRING_LENGTH = 2 * 1024; // 2 KB
export const MAX_METADATA_DEPTH = 8;
export const MAX_ARRAY_LENGTH = 100;
export const MAX_EVIDENCE_DRAFTS_PER_EVALUATION = 20;

const FORBIDDEN_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /privatekey/i,
  /encryptionkey/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /apikey/i,
  /^payload$/i,
  /^content$/i,
  /^body$/i,
];

function checkMetadataKey(key: string): void {
  for (const pattern of FORBIDDEN_KEY_PATTERNS) {
    if (pattern.test(key)) {
      throw new EvidenceValidationError(
        `Evidence metadata contains forbidden sensitive key: "${key}"`,
        'FORBIDDEN_KEY_DETECTED'
      );
    }
  }
}

function scanValue(val: unknown, currentDepth: number): void {
  if (currentDepth > MAX_METADATA_DEPTH) {
    throw new EvidenceValidationError(
      `Evidence metadata exceeds maximum nesting depth of ${MAX_METADATA_DEPTH}`,
      'EXCESSIVE_DEPTH'
    );
  }

  if (val === null || val === undefined) {
    return;
  }

  if (typeof val === 'string') {
    if (val.length > MAX_STRING_LENGTH) {
      throw new EvidenceValidationError(
        `Evidence metadata string exceeds maximum allowed length of ${MAX_STRING_LENGTH} characters`,
        'STRING_TOO_LONG'
      );
    }
    return;
  }

  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return;
  }

  if (val instanceof Date) {
    return;
  }

  if (Array.isArray(val)) {
    if (val.length > MAX_ARRAY_LENGTH) {
      throw new EvidenceValidationError(
        `Evidence metadata array exceeds maximum allowed length of ${MAX_ARRAY_LENGTH}`,
        'ARRAY_TOO_LONG'
      );
    }
    for (const item of val) {
      scanValue(item, currentDepth + 1);
    }
    return;
  }

  if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      checkMetadataKey(k);
      scanValue(v, currentDepth + 1);
    }
    return;
  }

  throw new EvidenceValidationError(
    `Unsupported value type in evidence metadata: ${typeof val}`,
    'INVALID_VALUE_TYPE'
  );
}

/**
 * Validates an evidence draft against strict safety and size criteria.
 * Throws EvidenceValidationError if validation fails.
 */
export function validateEvidenceDraft(draft: ComplianceEvidenceDraft): void {
  if (!draft.type) {
    throw new EvidenceValidationError('Evidence draft must have a valid type', 'INVALID_TYPE');
  }

  if (!draft.collectorId || typeof draft.collectorId !== 'string') {
    throw new EvidenceValidationError(
      'Evidence draft must have a valid collectorId',
      'INVALID_COLLECTOR_ID'
    );
  }

  if (!draft.collectorVersion || typeof draft.collectorVersion !== 'string') {
    throw new EvidenceValidationError(
      'Evidence draft must have a valid collectorVersion',
      'INVALID_COLLECTOR_VERSION'
    );
  }

  if (!draft.title || typeof draft.title !== 'string' || draft.title.trim().length === 0) {
    throw new EvidenceValidationError(
      'Evidence draft must have a non-empty title',
      'INVALID_TITLE'
    );
  }

  if (!(draft.observedAt instanceof Date) || isNaN(draft.observedAt.getTime())) {
    throw new EvidenceValidationError(
      'Evidence draft must have a valid observedAt Date',
      'INVALID_OBSERVED_AT'
    );
  }

  if (!draft.metadata || typeof draft.metadata !== 'object' || Array.isArray(draft.metadata)) {
    throw new EvidenceValidationError(
      'Evidence metadata must be a non-null object',
      'INVALID_METADATA'
    );
  }

  // Scan metadata structure for forbidden keys and size
  scanValue(draft.metadata, 1);

  // Serialized byte size constraint
  const serialized = JSON.stringify(draft.metadata);
  const byteSize = Buffer.byteLength(serialized, 'utf8');
  if (byteSize > MAX_METADATA_BYTES) {
    throw new EvidenceValidationError(
      `Evidence metadata size (${byteSize} bytes) exceeds maximum of ${MAX_METADATA_BYTES} bytes`,
      'METADATA_TOO_LARGE'
    );
  }
}

/**
 * Validates a collection of evidence drafts for an evaluation.
 */
export function validateEvidenceDrafts(drafts: readonly ComplianceEvidenceDraft[]): void {
  if (drafts.length > MAX_EVIDENCE_DRAFTS_PER_EVALUATION) {
    throw new EvidenceValidationError(
      `Evidence drafts count (${drafts.length}) exceeds maximum limit of ${MAX_EVIDENCE_DRAFTS_PER_EVALUATION} per evaluation`,
      'TOO_MANY_DRAFTS'
    );
  }

  for (const draft of drafts) {
    validateEvidenceDraft(draft);
  }
}
