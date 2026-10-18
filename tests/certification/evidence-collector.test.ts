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
    candidate_commit: '132fd34c8bf5a8a039bc0a8aba795c2079db16ca',
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
});
