import { describe, expect, it } from 'vitest';
import {
  TestEvidenceRecord,
  TestResultOutcome,
  validateTestEvidenceRecord,
  saveTestEvidence,
  loadAllTestEvidence,
} from '../../scripts/certification/evidence-collector';
import fs from 'node:fs';
import path from 'node:path';

describe('Evidence Collector Schema & Persistence', () => {
  const validRecord: TestEvidenceRecord = {
    test_id: 'AUTO-001',
    test_run_id: 'run-cert-001',
    candidate_commit: 'fa0f721f51d08c1e5641caa54c5bbd5889207723',
    server_image_digest: 'sha256:099023cbd024fac4c53435aaf2bff669f0e8bf04ba96564d3a3d62d6bdfe0d62',
    agent_image_digest: 'sha256:37bc11c606468af88134c11215b33a7e83654d4af8ea6c35231bc4d489afa5f3',
    environment: 'staging-isolated-lab',
    topology: 'docker-host-agent',
    test_start_time: '2026-10-18T10:00:00.000Z',
    test_end_time: '2026-10-18T10:01:30.000Z',
    service_id: 'srv-cert-01',
    integration_id: 'int-blackbox-01',
    alert_fingerprint: 'fp-docker-api-down',
    incident_id: 'inc-cert-001',
    rule_id: 'rule-auto-docker',
    rule_revision: 2,
    runbook_version_id: 'rb-v2-docker-restart',
    execution_id: 'exec-cert-001',
    step_attempt_ids: ['step-att-1', 'step-att-2'],
    agent_id: 'agent-docker-host-01',
    policy_hash: 'ph-ed25519-valid',
    result: 'PASS',
    physical_state_before: { status: 'Exited (0)', container: 'ag-e2e-docker-api' },
    physical_state_after: { status: 'Up (healthy)', container: 'ag-e2e-docker-api' },
    independent_health_result: { http_code: 200, response: { status: 'ok' } },
    log_artifact_paths: ['/tmp/test-artifacts/AUTO-001.log'],
  };

  it('validates a complete, compliant evidence record', () => {
    const res = validateTestEvidenceRecord(validRecord);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects records with missing required fields', () => {
    const incomplete = { ...validRecord, candidate_commit: '' };
    const res = validateTestEvidenceRecord(incomplete);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Missing required field: candidate_commit');
  });

  it('rejects records with invalid outcome states', () => {
    const invalidOutcome = {
      ...validRecord,
      result: 'SOME_UNKNOWN_STATE' as unknown as TestResultOutcome,
    };
    const res = validateTestEvidenceRecord(invalidOutcome);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('Invalid result outcome'))).toBe(true);
  });

  it('saves and loads evidence record round-trip', () => {
    const tempDir = path.resolve(
      process.cwd(),
      'plans/runbook-engine/enterprise-physical-certification/results/.test-temp'
    );
    try {
      const savedPath = saveTestEvidence(validRecord, tempDir);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(fs.existsSync(savedPath)).toBe(true);

      const loaded = loadAllTestEvidence(tempDir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].test_id).toBe('AUTO-001');
      expect(loaded[0].result).toBe('PASS');
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  describe('Enterprise Certification Gate (All Submitted Evidence)', () => {
    const expectedAutoIds = [
      'AUTO-001',
      'AUTO-002',
      'AUTO-003',
      'AUTO-004',
      'AUTO-005',
      'AUTO-006',
      'AUTO-007',
      'AUTO-008',
    ];
    const expectedHaIds = [
      'HA-001',
      'HA-002',
      'HA-003',
      'HA-004',
      'HA-005',
      'HA-006',
      'HA-007',
      'HA-008',
      'HA-009',
      'HA-010',
      'HA-011',
      'HA-012',
    ];
    const expectedCandidateCommit = 'e1ef56ea18f08b2d17d5f26996f95359d05e0005';

    it('strictly loads and validates all 20 certified evidence records without skipping or warnings', () => {
      const records = loadAllTestEvidence(undefined, true);
      expect(records.length).toBe(20);

      const testIds = records.map(r => r.test_id);
      for (const expectedId of [...expectedAutoIds, ...expectedHaIds]) {
        expect(testIds).toContain(expectedId);
      }
    });

    it('verifies that every submitted record satisfies the 25 required schema fields and chronological consistency', () => {
      const records = loadAllTestEvidence(undefined, true);

      for (const record of records) {
        const validation = validateTestEvidenceRecord(record);
        expect(
          validation.valid,
          `Record ${record.test_id} failed validation: ${validation.errors.join(', ')}`
        ).toBe(true);
        expect(validation.errors).toHaveLength(0);
        expect(record.candidate_commit).toBe(expectedCandidateCommit);

        if (record.test_id.startsWith('AUTO-') || record.test_id === 'HA-001') {
          expect(record.result).toBe('PASS');
          expect(record.execution_id).not.toBe('UNEXECUTED');
        } else {
          expect(record.result).toBe('NOT_TESTED');
          expect(record.execution_id).toBe('UNEXECUTED');
        }

        // Required non-empty fields check
        expect(record.service_id).toBeTruthy();
        expect(record.integration_id).toBeTruthy();
        expect(record.alert_fingerprint).toBeTruthy();
        expect(record.incident_id).toBeTruthy();
        expect(record.rule_id).toBeTruthy();
        expect(record.runbook_version_id).toBeTruthy();
        expect(record.execution_id).toBeTruthy();
        expect(record.log_artifact_paths.length).toBeGreaterThan(0);

        // Chronological consistency
        const start = Date.parse(record.test_start_time);
        const end = Date.parse(record.test_end_time);
        expect(isNaN(start)).toBe(false);
        expect(isNaN(end)).toBe(false);
        expect(start).toBeLessThanOrEqual(end);

        if (
          record.result === 'PASS' &&
          record.physical_state_after &&
          typeof record.physical_state_after === 'object' &&
          'startedAt' in record.physical_state_after &&
          typeof (record.physical_state_after as Record<string, unknown>).startedAt === 'string'
        ) {
          const startedAt = Date.parse(
            (record.physical_state_after as Record<string, unknown>).startedAt as string
          );
          expect(isNaN(startedAt)).toBe(false);
          expect(startedAt).toBeGreaterThanOrEqual(start);
          expect(startedAt).toBeLessThanOrEqual(end + 5000);
        }
      }
    });

    it('verifies execution ID cardinality: all certified PASS records have unique, distinct execution IDs', () => {
      const records = loadAllTestEvidence(undefined, true);
      const passRecords = records.filter(r => r.result === 'PASS');
      const executionIds = passRecords.map(r => r.execution_id);
      const uniqueExecutionIds = new Set(executionIds);

      expect(uniqueExecutionIds.size).toBe(passRecords.length);
      expect(passRecords.length).toBe(9); // AUTO-001..AUTO-008 + HA-001
    });
  });
});
