import fs from 'node:fs';
import path from 'node:path';

export type TestResultOutcome =
  'PASS' | 'FAIL' | 'FAILED_PRECHECK_DIAGNOSTIC' | 'BLOCKED' | 'NOT_TESTED' | 'NOT_SUPPORTED';

export interface TestEvidenceRecord {
  test_id: string;
  test_run_id: string;
  candidate_commit: string;
  server_image_digest: string;
  agent_image_digest: string;
  environment: string;
  topology: string;
  test_start_time: string;
  test_end_time: string;
  service_id: string;
  integration_id: string;
  alert_fingerprint: string;
  incident_id: string;
  rule_id: string;
  rule_revision: number | string;
  runbook_version_id: string;
  execution_id: string;
  step_attempt_ids: string[];
  agent_id: string;
  policy_hash: string;
  result: TestResultOutcome;
  physical_state_before: Record<string, unknown> | string;
  physical_state_after: Record<string, unknown> | string;
  independent_health_result: Record<string, unknown> | string;
  log_artifact_paths: string[];
  notes?: string;
}

const REQUIRED_FIELDS: (keyof TestEvidenceRecord)[] = [
  'test_id',
  'test_run_id',
  'candidate_commit',
  'server_image_digest',
  'agent_image_digest',
  'environment',
  'topology',
  'test_start_time',
  'test_end_time',
  'service_id',
  'integration_id',
  'alert_fingerprint',
  'incident_id',
  'rule_id',
  'rule_revision',
  'runbook_version_id',
  'execution_id',
  'step_attempt_ids',
  'agent_id',
  'policy_hash',
  'result',
  'physical_state_before',
  'physical_state_after',
  'independent_health_result',
  'log_artifact_paths',
];

const VALID_OUTCOMES: TestResultOutcome[] = [
  'PASS',
  'FAIL',
  'FAILED_PRECHECK_DIAGNOSTIC',
  'BLOCKED',
  'NOT_TESTED',
  'NOT_SUPPORTED',
];

export function validateTestEvidenceRecord(record: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be a non-null object'] };
  }

  const rec = record as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (rec[field] === undefined || rec[field] === null || rec[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (rec.result && !VALID_OUTCOMES.includes(rec.result as TestResultOutcome)) {
    errors.push(
      `Invalid result outcome: "${rec.result}". Allowed values: ${VALID_OUTCOMES.join(', ')}`
    );
  }

  if (rec.step_attempt_ids && !Array.isArray(rec.step_attempt_ids)) {
    errors.push('step_attempt_ids must be an array');
  }

  if (rec.log_artifact_paths && !Array.isArray(rec.log_artifact_paths)) {
    errors.push('log_artifact_paths must be an array');
  }

  // Chronological consistency validation
  if (typeof rec.test_start_time === 'string' && typeof rec.test_end_time === 'string') {
    const startTime = Date.parse(rec.test_start_time);
    const endTime = Date.parse(rec.test_end_time);
    if (isNaN(startTime)) {
      errors.push(`Invalid test_start_time timestamp: ${rec.test_start_time}`);
    }
    if (isNaN(endTime)) {
      errors.push(`Invalid test_end_time timestamp: ${rec.test_end_time}`);
    }
    if (!isNaN(startTime) && !isNaN(endTime) && startTime > endTime) {
      errors.push(
        `Chronological inconsistency: test_start_time (${rec.test_start_time}) is after test_end_time (${rec.test_end_time})`
      );
    }

    if (
      rec.physical_state_after &&
      typeof rec.physical_state_after === 'object' &&
      'startedAt' in rec.physical_state_after &&
      typeof (rec.physical_state_after as Record<string, unknown>).startedAt === 'string'
    ) {
      const startedAt = Date.parse(
        (rec.physical_state_after as Record<string, unknown>).startedAt as string
      );
      if (!isNaN(startedAt) && !isNaN(endTime) && startedAt > endTime + 5000) {
        errors.push(
          `Chronological inconsistency: physical_state_after.startedAt (${(rec.physical_state_after as Record<string, unknown>).startedAt}) occurred after test_end_time (${rec.test_end_time})`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function saveTestEvidence(
  record: TestEvidenceRecord,
  resultsDir = path.resolve(
    process.cwd(),
    'plans/runbook-engine/enterprise-physical-certification/results'
  )
): string {
  const validation = validateTestEvidenceRecord(record);
  if (!validation.valid) {
    throw new Error(`Cannot save invalid test evidence record: ${validation.errors.join('; ')}`);
  }

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const filePath = path.join(resultsDir, `${record.test_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}

export function loadAllTestEvidence(
  resultsDir = path.resolve(
    process.cwd(),
    'plans/runbook-engine/enterprise-physical-certification/results'
  ),
  strict = false
): TestEvidenceRecord[] {
  if (!fs.existsSync(resultsDir)) return [];

  const files = fs.readdirSync(resultsDir).filter(f => /^(AUTO|HA)-\d+\.json$/.test(f));
  const records: TestEvidenceRecord[] = [];

  for (const file of files) {
    const fullPath = path.join(resultsDir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(content) as TestEvidenceRecord;
      const validation = validateTestEvidenceRecord(parsed);
      if (validation.valid) {
        records.push(parsed);
      } else {
        if (strict) {
          throw new Error(
            `Evidence validation failed for ${file}: ${validation.errors.join('; ')}`
          );
        }
        console.warn(`[WARN] Skipping invalid evidence file ${file}:`, validation.errors);
      }
    } catch (err) {
      if (strict) throw err;
      console.warn(`[WARN] Failed to parse evidence file ${file}:`, err);
    }
  }

  return records;
}
