// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  validateEvidenceDraft,
  validateEvidenceDrafts,
  EvidenceValidationError,
  MAX_METADATA_BYTES,
  MAX_METADATA_DEPTH,
  MAX_EVIDENCE_DRAFTS_PER_EVALUATION,
} from '@/lib/compliance/evidence/validate';
import type { ComplianceEvidenceDraft } from '@/lib/compliance/evidence/types';

describe('compliance evidence safety validation', () => {
  const validDraft: ComplianceEvidenceDraft = {
    type: 'VERIFICATION_RESULT',
    collectorId: 'encryption.at-rest',
    collectorVersion: '1',
    title: 'Encryption Verification',
    observedAt: new Date(),
    metadata: {
      activeKeyId: 'k3',
      verifiedTargets: 17,
      currentV3: 1500,
      conflicts: 0,
    },
  };

  it('allows safe evidence metadata with normal facts and key identifiers', () => {
    expect(() => validateEvidenceDraft(validDraft)).not.toThrow();
  });

  it('rejects top-level forbidden sensitive keys', () => {
    const forbiddenKeys = [
      'password',
      'userPassword',
      'secret',
      'clientSecret',
      'token',
      'refreshToken',
      'privateKey',
      'encryptionKey',
      'authorization',
      'cookie',
      'session',
      'apiKey',
      'payload',
      'content',
      'body',
    ];

    for (const key of forbiddenKeys) {
      const draft: ComplianceEvidenceDraft = {
        ...validDraft,
        metadata: { [key]: 'sensitive_material' },
      };

      expect(() => validateEvidenceDraft(draft)).toThrowError(EvidenceValidationError);
    }
  });

  it('rejects nested forbidden sensitive keys', () => {
    const draft: ComplianceEvidenceDraft = {
      ...validDraft,
      metadata: {
        nested: {
          deep: {
            clientSecret: 'shh',
          },
        },
      },
    };

    expect(() => validateEvidenceDraft(draft)).toThrowError(/forbidden sensitive key/i);
  });

  it('rejects metadata exceeding maximum byte size', () => {
    const hugeString = 'x'.repeat(MAX_METADATA_BYTES + 100);
    const draft: ComplianceEvidenceDraft = {
      ...validDraft,
      metadata: {
        data: hugeString,
      },
    };

    expect(() => validateEvidenceDraft(draft)).toThrowError(/exceeds maximum/i);
  });

  it('rejects metadata exceeding maximum nesting depth', () => {
    let current: Record<string, unknown> = {};
    const root = current;
    for (let i = 0; i <= MAX_METADATA_DEPTH + 1; i++) {
      const next: Record<string, unknown> = {};
      current.level = next;
      current = next;
    }

    const draft: ComplianceEvidenceDraft = {
      ...validDraft,
      metadata: root,
    };

    expect(() => validateEvidenceDraft(draft)).toThrowError(/nesting depth/i);
  });

  it('rejects evidence drafts collection exceeding maximum count', () => {
    const excessiveDrafts = Array.from(
      { length: MAX_EVIDENCE_DRAFTS_PER_EVALUATION + 1 },
      () => validDraft
    );

    expect(() => validateEvidenceDrafts(excessiveDrafts)).toThrowError(/maximum limit/i);
  });
});
