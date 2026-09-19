import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMPLIANCE_EVIDENCE_TYPES } from '@/lib/compliance/evidence/types';
import { complianceEvaluatorRegistry } from '@/lib/compliance/evaluators';
import { COLLECTOR_EVIDENCE_SCHEMAS } from '@/lib/compliance/evidence/schemas';

describe('compliance evidence architecture contract', () => {
  it('guarantees compliance evidence records are strictly append-only (no update or delete in application code)', () => {
    const rootSrcDirectory = path.resolve(process.cwd(), 'src');

    function walkDirectory(targetDir: string): string[] {
      const dirEntries = fs.readdirSync(targetDir, { withFileTypes: true });
      const accumulatedFiles: string[] = [];
      for (const entry of dirEntries) {
        const resolvedPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
          accumulatedFiles.push(...walkDirectory(resolvedPath));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          accumulatedFiles.push(resolvedPath);
        }
      }
      return accumulatedFiles;
    }

    const allTsFiles = walkDirectory(rootSrcDirectory);
    const forbiddenPatterns = [
      /\.complianceEvidence\.update\(/,
      /\.complianceEvidence\.updateMany\(/,
      /\.complianceEvidence\.delete\(/,
      /\.complianceEvidence\.deleteMany\(/,
    ];

    for (const filePath of allTsFiles) {
      const fileSource = fs.readFileSync(filePath, 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(fileSource),
          `File ${filePath} violates evidence immutability contract by matching ${pattern}`
        ).toBe(false);
      }
    }
  });

  it('guarantees schema enforces foreign key onDelete: Restrict and contentHash index', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    // Evidence must restrict deletion when parent evaluation is deleted
    expect(schemaContent).toMatch(
      /model ComplianceEvidence\s*\{[\s\S]*?evaluation\s+ComplianceEvaluation\s+@relation\([^)]*?onDelete:\s*Restrict[^)]*?\)/
    );

    // Schema must index contentHash
    expect(schemaContent).toMatch(
      /model ComplianceEvidence\s*\{[\s\S]*?@@index\(\[contentHash\]\)/
    );
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

  it('guarantees every registered compliance evaluator has a registered evidence schema', () => {
    const evaluatorIds = Object.keys(complianceEvaluatorRegistry);
    expect(evaluatorIds.length).toBeGreaterThanOrEqual(6);

    const schemaKeys = new Set(Object.keys(COLLECTOR_EVIDENCE_SCHEMAS));
    for (const id of evaluatorIds) {
      expect(
        schemaKeys.has(id),
        `Evaluator "${id}" is registered in complianceEvaluatorRegistry but missing in COLLECTOR_EVIDENCE_SCHEMAS`
      ).toBe(true);
    }
  });
});
