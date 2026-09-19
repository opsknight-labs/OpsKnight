// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  computeEvidenceContentHash,
  verifyComplianceEvidenceHash,
} from '@/lib/compliance/evidence/hash';
import { toCanonicalJson } from '@/lib/compliance/evidence/canonicalize';
import type { ComplianceEvidenceDraft } from '@/lib/compliance/evidence/types';

describe('compliance evidence hashing and canonicalization', () => {
  const baseDraft: ComplianceEvidenceDraft = {
    type: 'VERIFICATION_RESULT',
    collectorId: 'encryption.at-rest',
    collectorVersion: '1',
    title: 'Encryption Verification',
    description: 'All records verified clean.',
    resourceType: 'EncryptionMigrationRun',
    resourceId: 'run-123',
    observedAt: new Date('2026-09-19T20:00:00.000Z'),
    validUntil: null,
    metadata: {
      activeKeyId: 'k3',
      currentV3: 1532,
      conflicts: 0,
    },
  };

  it('produces identical canonical JSON regardless of object key insertion order', () => {
    const objA = { z: 1, a: 2, m: { y: 10, b: 20 } };
    const objB = { a: 2, m: { b: 20, y: 10 }, z: 1 };

    expect(toCanonicalJson(objA)).toBe(toCanonicalJson(objB));
    expect(toCanonicalJson(objA)).toBe('{"a":2,"m":{"b":20,"y":10},"z":1}');
  });

  it('computes identical SHA-256 hash when metadata key ordering differs', () => {
    const draftA: ComplianceEvidenceDraft = {
      ...baseDraft,
      metadata: { activeKeyId: 'k3', currentV3: 1532, conflicts: 0 },
    };

    const draftB: ComplianceEvidenceDraft = {
      ...baseDraft,
      metadata: { conflicts: 0, activeKeyId: 'k3', currentV3: 1532 },
    };

    const hashA = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: draftA,
    });

    const hashB = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: draftB,
    });

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('computes different hash when metadata values differ', () => {
    const draftModified: ComplianceEvidenceDraft = {
      ...baseDraft,
      metadata: { ...baseDraft.metadata, currentV3: 1533 },
    };

    const hashOriginal = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: baseDraft,
    });

    const hashModified = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: draftModified,
    });

    expect(hashOriginal).not.toBe(hashModified);
  });

  it('computes different hash when observedAt timestamp differs', () => {
    const draftModified: ComplianceEvidenceDraft = {
      ...baseDraft,
      observedAt: new Date('2026-09-19T20:00:01.000Z'),
    };

    const hashOriginal = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: baseDraft,
    });

    const hashModified = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: draftModified,
    });

    expect(hashOriginal).not.toBe(hashModified);
  });

  it('computes different hash when controlId or evaluationId differs', () => {
    const hashA = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: baseDraft,
    });

    const hashB = computeEvidenceContentHash({
      controlId: 'SEC-ENC-002',
      evaluationId: 'eval-1',
      draft: baseDraft,
    });

    const hashC = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-2',
      draft: baseDraft,
    });

    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });

  it('verifies valid evidence hash and detects tampering across all individual fields', () => {
    const collectedAt = new Date('2026-09-19T20:01:00.000Z');
    const hash = computeEvidenceContentHash({
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      draft: baseDraft,
      collectedAt,
    });

    const validRecord = {
      controlId: 'SEC-ENC-001',
      evaluationId: 'eval-1',
      type: baseDraft.type,
      collectorId: baseDraft.collectorId,
      collectorVersion: baseDraft.collectorVersion,
      title: baseDraft.title,
      description: baseDraft.description ?? null,
      resourceType: baseDraft.resourceType ?? null,
      resourceId: baseDraft.resourceId ?? null,
      observedAt: baseDraft.observedAt,
      collectedAt,
      validUntil: baseDraft.validUntil ?? null,
      metadata: baseDraft.metadata,
      contentHash: hash,
    };

    expect(verifyComplianceEvidenceHash(validRecord)).toBe(true);

    // Tampered title
    expect(verifyComplianceEvidenceHash({ ...validRecord, title: 'Tampered Title' })).toBe(false);

    // Tampered description
    expect(
      verifyComplianceEvidenceHash({ ...validRecord, description: 'Tampered Description' })
    ).toBe(false);

    // Tampered collectedAt
    expect(
      verifyComplianceEvidenceHash({
        ...validRecord,
        collectedAt: new Date('2026-09-19T20:02:00.000Z'),
      })
    ).toBe(false);

    // Tampered controlId
    expect(verifyComplianceEvidenceHash({ ...validRecord, controlId: 'SEC-ENC-002' })).toBe(false);

    // Tampered evaluationId
    expect(verifyComplianceEvidenceHash({ ...validRecord, evaluationId: 'eval-999' })).toBe(false);

    // Tampered type
    expect(verifyComplianceEvidenceHash({ ...validRecord, type: 'CAPABILITY_CHECK' })).toBe(false);

    // Tampered collectorId
    expect(verifyComplianceEvidenceHash({ ...validRecord, collectorId: 'other.collector' })).toBe(
      false
    );

    // Tampered collectorVersion
    expect(verifyComplianceEvidenceHash({ ...validRecord, collectorVersion: '2' })).toBe(false);

    // Tampered resourceType
    expect(verifyComplianceEvidenceHash({ ...validRecord, resourceType: 'OtherResource' })).toBe(
      false
    );

    // Tampered resourceId
    expect(verifyComplianceEvidenceHash({ ...validRecord, resourceId: 'run-999' })).toBe(false);

    // Tampered observedAt
    expect(
      verifyComplianceEvidenceHash({
        ...validRecord,
        observedAt: new Date('2026-09-19T20:00:01.000Z'),
      })
    ).toBe(false);

    // Tampered validUntil
    expect(
      verifyComplianceEvidenceHash({
        ...validRecord,
        validUntil: new Date('2026-09-20T20:00:00.000Z'),
      })
    ).toBe(false);

    // Tampered metadata
    expect(
      verifyComplianceEvidenceHash({
        ...validRecord,
        metadata: { ...validRecord.metadata, currentV3: 99999 },
      })
    ).toBe(false);
  });
});
