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
      completedVerifyRunFound: false,
      activeKeyId: 'k3',
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

  it('rejects raw credentials in title, description, or resource fields', () => {
    const draftWithSecretTitle: ComplianceEvidenceDraft = {
      ...validDraft,
      title: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive',
    };
    expect(() => validateEvidenceDraft(draftWithSecretTitle)).toThrowError(
      /forbidden sensitive credential pattern/i
    );

    const draftWithPrivateKey: ComplianceEvidenceDraft = {
      ...validDraft,
      description: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0',
    };
    expect(() => validateEvidenceDraft(draftWithPrivateKey)).toThrowError(
      /forbidden sensitive credential pattern/i
    );
  });

  it('rejects collector provenance mismatch', () => {
    expect(() =>
      validateEvidenceDraft(validDraft, {
        expectedCollectorId: 'data.retention',
        expectedCollectorVersion: '1',
      })
    ).toThrowError(/collectorId mismatch/i);

    expect(() =>
      validateEvidenceDraft(validDraft, {
        expectedCollectorId: 'encryption.at-rest',
        expectedCollectorVersion: '2',
      })
    ).toThrowError(/collectorVersion mismatch/i);
  });

  it('rejects metadata violating exact collector Zod schema', () => {
    const draftWithInvalidField: ComplianceEvidenceDraft = {
      ...validDraft,
      metadata: {
        completedVerifyRunFound: false,
        activeKeyId: 'k3',
        unexpectedField: 'invalid_extra_data',
      },
    };

    try {
      validateEvidenceDraft(draftWithInvalidField);
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(EvidenceValidationError);
      expect((err as EvidenceValidationError).code).toBe('SCHEMA_VALIDATION_FAILED');
      expect((err as EvidenceValidationError).message).toContain('violates collector');
    }
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

  it('rejects empty evidence drafts collection (EVIDENCE_REQUIRED)', () => {
    try {
      validateEvidenceDrafts([]);
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(EvidenceValidationError);
      expect((err as EvidenceValidationError).code).toBe('EVIDENCE_REQUIRED');
      expect((err as EvidenceValidationError).message).toContain('must provide evidence');
    }
  });

  it('rejects evidence drafts collection exceeding maximum count', () => {
    const excessiveDrafts = Array.from(
      { length: MAX_EVIDENCE_DRAFTS_PER_EVALUATION + 1 },
      () => validDraft
    );

    expect(() => validateEvidenceDrafts(excessiveDrafts)).toThrowError(/maximum limit/i);
  });
});
