import { describe, expect, it } from 'vitest';
import { compareComplianceObservations } from '@/lib/compliance/drift/comparator';
import type { ComplianceObservation } from '@/lib/compliance/drift/types';

describe('compareComplianceObservations', () => {
  const implementedObs: ComplianceObservation = {
    controlId: 'ENC-01',
    status: 'IMPLEMENTED',
    evaluatorId: 'eval-enc-01',
    evaluatorVersion: '1.0.0',
    findings: [{ code: 'tls-version', severity: 'INFO' }],
    evidenceIntegrity: { total: 1, mismatches: 0 },
  };

  it('returns no drift when previous and current are identical', () => {
    const current = { ...implementedObs };
    const drifts = compareComplianceObservations(implementedObs, current);

    expect(drifts).toHaveLength(0);
  });

  it('detects CONTROL_STATUS_REGRESSION when status transitions from IMPLEMENTED to ACTION_REQUIRED', () => {
    const current: ComplianceObservation = {
      ...implementedObs,
      status: 'ACTION_REQUIRED',
    };

    const drifts = compareComplianceObservations(implementedObs, current);
    const regression = drifts.find(d => d.kind === 'CONTROL_STATUS_REGRESSION');

    expect(regression).toBeDefined();
    expect(regression?.impact).toBe('ACTION_REQUIRED');
    expect(regression?.previousStatus).toBe('IMPLEMENTED');
    expect(regression?.currentStatus).toBe('ACTION_REQUIRED');
  });

  it('detects CONTROL_UNVERIFIED when status transitions to UNVERIFIED', () => {
    const current: ComplianceObservation = {
      ...implementedObs,
      status: 'UNVERIFIED',
    };

    const drifts = compareComplianceObservations(implementedObs, current);
    const gap = drifts.find(d => d.kind === 'CONTROL_UNVERIFIED');

    expect(gap).toBeDefined();
    expect(gap?.impact).toBe('VERIFICATION_GAP');
  });

  it('detects EVALUATOR_VERSION_CHANGED when evaluator version updates', () => {
    const current: ComplianceObservation = {
      ...implementedObs,
      evaluatorVersion: '2.0.0',
    };

    const drifts = compareComplianceObservations(implementedObs, current);
    const versionDrift = drifts.find(d => d.kind === 'EVALUATOR_VERSION_CHANGED');

    expect(versionDrift).toBeDefined();
    expect(versionDrift?.impact).toBe('INFORMATIONAL');
    expect(versionDrift?.details).toMatchObject({
      previousVersion: '1.0.0',
      currentVersion: '2.0.0',
    });
  });

  it('detects EVIDENCE_INTEGRITY_MISMATCH when current evidence has new mismatches', () => {
    const current: ComplianceObservation = {
      ...implementedObs,
      evidenceIntegrity: { total: 1, mismatches: 1 },
    };

    const drifts = compareComplianceObservations(implementedObs, current);
    const integrityDrift = drifts.find(d => d.kind === 'EVIDENCE_INTEGRITY_MISMATCH');

    expect(integrityDrift).toBeDefined();
    expect(integrityDrift?.impact).toBe('ACTION_REQUIRED');
  });

  it('detects FINDING_SET_CHANGED when findings change', () => {
    const current: ComplianceObservation = {
      ...implementedObs,
      findings: [
        { code: 'tls-version', severity: 'INFO' },
        { code: 'weak-cipher', severity: 'HIGH' },
      ],
    };

    const drifts = compareComplianceObservations(implementedObs, current);
    const findingDrift = drifts.find(d => d.kind === 'FINDING_SET_CHANGED');

    expect(findingDrift).toBeDefined();
    expect(findingDrift?.impact).toBe('ACTION_REQUIRED');
  });

  it('detects technical recovery when regressed control returns to IMPLEMENTED', () => {
    const regressedObs: ComplianceObservation = {
      ...implementedObs,
      status: 'ACTION_REQUIRED',
    };

    const recoveredObs: ComplianceObservation = {
      ...implementedObs,
      status: 'IMPLEMENTED',
    };

    const drifts = compareComplianceObservations(regressedObs, recoveredObs);
    const recovery = drifts.find(d => d.isRecovery === true);

    expect(recovery).toBeDefined();
    expect(recovery?.recoveryKind).toBe('CONTROL_STATUS_REGRESSION');
    expect(recovery?.impact).toBe('INFORMATIONAL');
  });

  it('does NOT auto-resolve EVIDENCE_INTEGRITY_MISMATCH when subsequent observation is clean', () => {
    const mismatchedObs: ComplianceObservation = {
      ...implementedObs,
      evidenceIntegrity: { total: 1, mismatches: 1 },
    };

    const cleanObs: ComplianceObservation = {
      ...implementedObs,
      evidenceIntegrity: { total: 1, mismatches: 0 },
    };

    const drifts = compareComplianceObservations(mismatchedObs, cleanObs);
    const integrityRecovery = drifts.find(
      d => d.isRecovery && d.recoveryKind === 'EVIDENCE_INTEGRITY_MISMATCH'
    );

    expect(integrityRecovery).toBeUndefined();
  });

  it('detects FINDING_SET_CHANGED recovery when all previous findings are cleared', () => {
    const withFindings: ComplianceObservation = {
      ...implementedObs,
      findings: [{ code: 'weak-cipher', severity: 'HIGH' }],
    };

    const clearedFindings: ComplianceObservation = {
      ...implementedObs,
      findings: [],
    };

    const drifts = compareComplianceObservations(withFindings, clearedFindings);
    const findingRecovery = drifts.find(
      d => d.isRecovery && d.recoveryKind === 'FINDING_SET_CHANGED'
    );

    expect(findingRecovery).toBeDefined();
    expect(findingRecovery?.details).toMatchObject({
      clearedFindings: ['weak-cipher'],
    });
  });
});
