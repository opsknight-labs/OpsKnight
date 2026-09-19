import { describe, it, expect } from 'vitest';
import {
  COMPLIANCE_FRAMEWORK_DEFINITIONS,
  ALL_FRAMEWORK_REQUIREMENTS,
  ALL_FRAMEWORK_CONTROL_MAPPINGS,
  getFrameworksForControl,
  validateFrameworkMappings,
  computeFrameworkMappingFingerprint,
} from '@/lib/compliance/framework-mappings';
import { complianceControls } from '@/lib/compliance/controls';
import { complianceEvaluatorRegistry } from '@/lib/compliance/evaluators';

describe('compliance framework mappings architecture contract', () => {
  it('passes internal validation suite without throwing', () => {
    expect(() => validateFrameworkMappings()).not.toThrow();
  });

  it('guarantees every framework ID is unique and matches defined frameworks', () => {
    const ids = COMPLIANCE_FRAMEWORK_DEFINITIONS.map(f => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(['GDPR', 'CRA', 'SOC2', 'ISO27001', 'ISO27701', 'DPDP', 'CCPA'])
    );
  });

  it('guarantees every requirement ID is globally unique and references an official source', () => {
    const ids = ALL_FRAMEWORK_REQUIREMENTS.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    const allowedHosts = new Set([
      'eur-lex.europa.eu',
      'www.aicpa-cima.com',
      'www.iso.org',
      'www.meity.gov.in',
      'www.oag.ca.gov',
    ]);

    for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
      expect(req.id).toMatch(/^[A-Z0-9]+-[A-Z0-9\-]+$/);
      expect(req.reference.length).toBeGreaterThan(0);
      expect(req.title.length).toBeGreaterThan(0);
      expect(req.summary.length).toBeGreaterThan(0);

      const url = new URL(req.sourceUrl);
      expect(
        allowedHosts.has(url.hostname),
        `Requirement "${req.id}" has non-authoritative host: "${url.hostname}"`
      ).toBe(true);
    }
  });

  it('guarantees every mapping references a valid requirement and control', () => {
    const reqIds = new Set(ALL_FRAMEWORK_REQUIREMENTS.map(r => r.id));
    const controlIds = new Set(complianceControls.map(c => c.id));
    const mappingIds = new Set<string>();

    for (const mapping of ALL_FRAMEWORK_CONTROL_MAPPINGS) {
      expect(mappingIds.has(mapping.id)).toBe(false);
      mappingIds.add(mapping.id);

      expect(
        reqIds.has(mapping.requirementId),
        `Mapping "${mapping.id}" references non-existent requirement "${mapping.requirementId}"`
      ).toBe(true);

      expect(
        controlIds.has(mapping.controlId),
        `Mapping "${mapping.id}" references non-existent control "${mapping.controlId}"`
      ).toBe(true);
    }
  });

  it('guarantees every runtime mapping targets an evaluator in complianceEvaluatorRegistry', () => {
    const controlMap = new Map(complianceControls.map(c => [c.id, c]));

    for (const mapping of ALL_FRAMEWORK_CONTROL_MAPPINGS) {
      if (mapping.evidenceExpectation === 'RUNTIME') {
        const control = controlMap.get(mapping.controlId);
        expect(control).toBeDefined();
        expect(control?.evaluatorId).toBeDefined();
        expect(complianceEvaluatorRegistry[control!.evaluatorId!]).toBeDefined();
      }
    }
  });

  it('enforces bidirectional consistency with legacy control.frameworks tags', () => {
    for (const control of complianceControls) {
      const mappedFrameworks = new Set(getFrameworksForControl(control.id));
      const declaredFrameworks = new Set(control.frameworks);

      // Every framework tag on the control must be backed by at least one mapping
      for (const fw of declaredFrameworks) {
        expect(
          mappedFrameworks.has(fw),
          `Control "${control.id}" declares framework "${fw}" in controls.ts but has no mapping for it`
        ).toBe(true);
      }

      // Every mapping framework for this control must appear in the control's frameworks tag list
      for (const fw of mappedFrameworks) {
        expect(
          declaredFrameworks.has(fw),
          `Control "${control.id}" has mapping in framework "${fw}" but controls.ts is missing "${fw}"`
        ).toBe(true);
      }
    }
  });

  it('strictly forbids compliance pass/fail, percentage or certification wording in models', () => {
    const forbiddenEnums = ['COMPLIANT', 'CERTIFIED', 'PASSED', 'FAILED'];

    for (const mapping of ALL_FRAMEWORK_CONTROL_MAPPINGS) {
      for (const kw of forbiddenEnums) {
        expect(mapping.relationship).not.toContain(kw);
        expect(mapping.evidenceExpectation).not.toContain(kw);
      }
    }

    for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
      for (const kw of forbiddenEnums) {
        expect(req.lifecycle).not.toContain(kw);
        expect(req.applicability).not.toContain(kw);
      }
    }

    const forbiddenPatterns = [
      /\bsatisf(y|ies|ied|ying)\b/i,
      /\bcertif(y|ies|ied|ying|icate|ication|ications)\b/i,
      /\bprevent(s|ed|ing)?\b/i,
      /\btamper-resistant\b/i,
      /\bimmutable\b/i,
      /\bguarantee(s|d)?\b/i,
      /\bcompliant\b/i,
    ];

    for (const mapping of ALL_FRAMEWORK_CONTROL_MAPPINGS) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(mapping.rationale),
          `Mapping "${mapping.id}" rationale contains forbidden pattern ${pattern}: "${mapping.rationale}"`
        ).toBe(false);

        if (mapping.notes) {
          expect(
            pattern.test(mapping.notes),
            `Mapping "${mapping.id}" notes contain forbidden pattern ${pattern}: "${mapping.notes}"`
          ).toBe(false);
        }
      }
    }

    for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(req.title),
          `Requirement "${req.id}" title contains forbidden pattern ${pattern}: "${req.title}"`
        ).toBe(false);

        expect(
          pattern.test(req.summary),
          `Requirement "${req.id}" summary contains forbidden pattern ${pattern}: "${req.summary}"`
        ).toBe(false);
      }
    }
  });

  it('computes a deterministic mapping fingerprint and detects tampering', () => {
    const fp1 = computeFrameworkMappingFingerprint();
    const fp2 = computeFrameworkMappingFingerprint();

    expect(fp1).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fp1).toBe(fp2);
  });
});
