import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMPLIANCE_EVIDENCE_TYPES } from '@/lib/compliance/evidence/types';
import { complianceEvaluatorRegistry } from '@/lib/compliance/evaluators';

describe('compliance evidence architecture contract', () => {
  it('guarantees compliance evidence records are strictly append-only (no update or delete)', () => {
    const srcDir = path.resolve(process.cwd(), 'src');

    function scanFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanFiles(fullPath));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const allTsFiles = scanFiles(srcDir);
    const forbiddenPatterns = [
      /\.complianceEvidence\.update\(/,
      /\.complianceEvidence\.updateMany\(/,
      /\.complianceEvidence\.delete\(/,
      /\.complianceEvidence\.deleteMany\(/,
    ];

    for (const file of allTsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(content),
          `File ${file} violates evidence immutability contract by matching ${pattern}`
        ).toBe(false);
      }
    }
  });

  it('verifies all registered evaluators are present and versioned', () => {
    const evaluatorIds = Object.keys(complianceEvaluatorRegistry);
    expect(evaluatorIds.length).toBeGreaterThanOrEqual(6);

    for (const [id, evaluator] of Object.entries(complianceEvaluatorRegistry)) {
      expect(evaluator.id).toBe(id);
      expect(evaluator.version).toBe('1');
      expect(typeof evaluator.evaluate).toBe('function');
    }
  });

  it('verifies all evidence types match expected enum values', () => {
    const expectedTypes = [
      'VERIFICATION_RESULT',
      'CONFIGURATION_SNAPSHOT',
      'SYSTEM_STATE',
      'CAPABILITY_CHECK',
      'EXECUTION_SUMMARY',
      'EVALUATION_FAILURE',
    ];

    expect(COMPLIANCE_EVIDENCE_TYPES).toEqual(expect.arrayContaining(expectedTypes));
    expect(COMPLIANCE_EVIDENCE_TYPES).toHaveLength(expectedTypes.length);
  });
});
