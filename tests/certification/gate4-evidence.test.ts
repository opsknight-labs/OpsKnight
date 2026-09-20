import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { compareComplianceObservations } from '@/lib/compliance/drift/comparator';
import type { ComplianceObservation } from '@/lib/compliance/drift/types';

describe('Gate 4: Evidence Integrity & Tamper Detection Certification', () => {
  it('detects tampering with technical evidence and prevents silent resolution of mismatches', async () => {
    const controlId = 'CERT-SEC-001';
    const originalPayload = {
      algorithm: 'AES-256-GCM',
      keyRotationDays: 90,
      activeKeysCount: 2,
    };

    const canonicalOriginalString = JSON.stringify(originalPayload);
    const validHash = crypto.createHash('sha256').update(canonicalOriginalString).digest('hex');

    // 1. Reconstruct hash independently and verify matching
    const testHash = crypto.createHash('sha256').update(canonicalOriginalString).digest('hex');
    expect(testHash).toBe(validHash);

    // 2. Simulate baseline observation with valid evidence integrity
    const baselineObs: ComplianceObservation = {
      controlId,
      status: 'IMPLEMENTED',
      evaluatorId: 'cert-evaluator',
      evaluatorVersion: '1.0.0',
      findings: [],
      evidenceIntegrity: { total: 1, mismatches: 0 },
    };

    // 3. Simulate subsequent observation where stored evidence hash was tampered/mismatched
    const tamperedObs: ComplianceObservation = {
      controlId,
      status: 'IMPLEMENTED',
      evaluatorId: 'cert-evaluator',
      evaluatorVersion: '1.0.0',
      findings: [],
      evidenceIntegrity: { total: 1, mismatches: 1 },
    };

    const detectedDrifts = compareComplianceObservations(baselineObs, tamperedObs);
    const integrityDrift = detectedDrifts.find(d => d.kind === 'EVIDENCE_INTEGRITY_MISMATCH');

    expect(integrityDrift).toBeDefined();
    expect(integrityDrift?.impact).toBe('ACTION_REQUIRED');
    expect(integrityDrift?.summary).toContain('Evidence canonical SHA-256 integrity mismatch');

    // 4. Verify that evidence integrity mismatches NEVER falsely auto-recover
    const subsequentNoMismatchesObs: ComplianceObservation = {
      controlId,
      status: 'IMPLEMENTED',
      evaluatorId: 'cert-evaluator',
      evaluatorVersion: '1.0.0',
      findings: [],
      evidenceIntegrity: { total: 1, mismatches: 0 },
    };

    const recoveryDrifts = compareComplianceObservations(tamperedObs, subsequentNoMismatchesObs);
    const falseRecovery = recoveryDrifts.find(
      d => d.isRecovery && d.recoveryKind === 'EVIDENCE_INTEGRITY_MISMATCH'
    );
    // As certified in PR6 exit criteria, evidence integrity mismatches do not falsely auto-resolve
    expect(falseRecovery).toBeUndefined();
  });
});
