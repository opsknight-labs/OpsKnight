// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { complianceControls } from '@/lib/compliance/controls';
import { complianceEvaluatorRegistry, getComplianceEvaluator } from '@/lib/compliance/evaluators';
import {
  computeComplianceControlRegistryFingerprint,
  getRuntimeComplianceControls,
} from '@/lib/compliance/registry';

describe('compliance runtime registry architecture contract', () => {
  it('enforces unique control IDs', () => {
    const ids = complianceControls.map(c => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('enforces valid and unique evaluator IDs in evaluator registry', () => {
    const evaluatorEntries = Object.entries(complianceEvaluatorRegistry);
    expect(evaluatorEntries.length).toBeGreaterThan(0);

    const seenIds = new Set<string>();
    for (const [id, evaluator] of evaluatorEntries) {
      expect(evaluator.id).toBe(id);
      expect(evaluator.version).toBeDefined();
      expect(evaluator.version.trim().length).toBeGreaterThan(0);
      expect(typeof evaluator.evaluate).toBe('function');
      expect(seenIds.has(id)).toBe(false);
      seenIds.add(id);
    }
  });

  it('ensures every runtime control references a valid, registered evaluator', () => {
    const runtimeControls = getRuntimeComplianceControls();
    expect(runtimeControls.length).toBeGreaterThanOrEqual(6);

    for (const control of runtimeControls) {
      expect(control.assessmentMode).toBe('RUNTIME');
      expect(control.evaluatorId).toBeDefined();
      const evaluator = getComplianceEvaluator(control.evaluatorId!);
      expect(evaluator).toBeDefined();
      expect(evaluator!.id).toBe(control.evaluatorId);
    }
  });

  it('ensures catalog-only controls do not declare an evaluatorId', () => {
    const catalogControls = complianceControls.filter(c => c.assessmentMode === 'CATALOG');
    expect(catalogControls.length).toBeGreaterThan(0);

    for (const control of catalogControls) {
      expect(control.evaluatorId).toBeUndefined();
    }
  });

  it('ensures all controls reference valid framework IDs', () => {
    const validFrameworks = new Set([
      'CRA',
      'GDPR',
      'SOC2',
      'ISO27001',
      'ISO27701',
      'DPDP',
      'CCPA',
    ]);

    for (const control of complianceControls) {
      expect(control.frameworks.length).toBeGreaterThan(0);
      for (const fw of control.frameworks) {
        expect(validFrameworks.has(fw)).toBe(true);
      }
    }
  });

  it('computes a deterministic control registry fingerprint', () => {
    const fp1 = computeComplianceControlRegistryFingerprint();
    const fp2 = computeComplianceControlRegistryFingerprint();
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });
});
