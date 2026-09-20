import { describe, expect, it } from 'vitest';
import {
  computeComplianceObservationFingerprint,
  computeFindingSetFingerprint,
  computeEvidenceIntegrityFingerprint,
} from '@/lib/compliance/drift/fingerprint';
import type { ComplianceObservation } from '@/lib/compliance/drift/types';

describe('computeComplianceObservationFingerprint', () => {
  const baseObservation: ComplianceObservation = {
    controlId: 'ENC-01',
    status: 'IMPLEMENTED',
    evaluatorId: 'eval-enc-01',
    evaluatorVersion: '1.0.0',
    findings: [
      { code: 'tls-version', severity: 'INFO' },
      { code: 'hsts-enabled', severity: 'INFO' },
    ],
    evidenceIntegrity: { total: 2, mismatches: 0 },
  };

  it('generates a deterministic 64-character hex SHA-256 fingerprint', () => {
    const fp1 = computeComplianceObservationFingerprint(baseObservation);
    const fp2 = computeComplianceObservationFingerprint(baseObservation);

    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    expect(fp1).toBe(fp2);
  });

  it('normalizes finding order deterministically', () => {
    const obs1: ComplianceObservation = {
      ...baseObservation,
      findings: [
        { code: 'tls-version', severity: 'INFO' },
        { code: 'hsts-enabled', severity: 'INFO' },
      ],
    };

    const obs2: ComplianceObservation = {
      ...baseObservation,
      findings: [
        { code: 'hsts-enabled', severity: 'INFO' },
        { code: 'tls-version', severity: 'INFO' },
      ],
    };

    expect(computeComplianceObservationFingerprint(obs1)).toBe(
      computeComplianceObservationFingerprint(obs2)
    );
  });

  it('changes fingerprint when status changes', () => {
    const fpOriginal = computeComplianceObservationFingerprint(baseObservation);
    const fpChanged = computeComplianceObservationFingerprint({
      ...baseObservation,
      status: 'ACTION_REQUIRED',
    });

    expect(fpChanged).not.toBe(fpOriginal);
  });

  it('changes fingerprint when findings change', () => {
    const fpOriginal = computeComplianceObservationFingerprint(baseObservation);
    const fpChanged = computeComplianceObservationFingerprint({
      ...baseObservation,
      findings: [{ code: 'tls-version', severity: 'ERROR' }],
    });

    expect(fpChanged).not.toBe(fpOriginal);
  });

  it('changes fingerprint when evidence integrity mismatches change', () => {
    const fpOriginal = computeComplianceObservationFingerprint(baseObservation);
    const fpChanged = computeComplianceObservationFingerprint({
      ...baseObservation,
      evidenceIntegrity: { total: 2, mismatches: 1 },
    });

    expect(fpChanged).not.toBe(fpOriginal);
  });

  it('computes sub-fingerprints for findings and evidence integrity', () => {
    const findFp = computeFindingSetFingerprint(baseObservation.findings);
    const intFp = computeEvidenceIntegrityFingerprint(baseObservation.evidenceIntegrity);

    expect(findFp).toMatch(/^[a-f0-9]{64}$/);
    expect(intFp).toMatch(/^[a-f0-9]{64}$/);
  });
});
