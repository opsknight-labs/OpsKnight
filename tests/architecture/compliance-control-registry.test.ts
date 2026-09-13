// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { complianceControls } from '@/lib/compliance/controls';
import { complianceEvidence, evidenceSourceUrl } from '@/lib/compliance/evidence';
import { frameworks } from '@/lib/compliance/frameworks';
import { getReadiness } from '@/lib/compliance/readiness';

const repositoryFiles = new Set(
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n')
);

const frameworkDocuments = {
  CCPA: readFileSync('docs/compliance/frameworks/ccpa.md', 'utf8'),
  CRA: readFileSync('docs/compliance/frameworks/cra.md', 'utf8'),
  DPDP: readFileSync('docs/compliance/frameworks/dpdp.md', 'utf8'),
  GDPR: readFileSync('docs/compliance/frameworks/gdpr.md', 'utf8'),
  ISO27001: readFileSync('docs/compliance/frameworks/iso27001.md', 'utf8'),
  ISO27701: readFileSync('docs/compliance/frameworks/iso27701.md', 'utf8'),
  SOC2: readFileSync('docs/compliance/frameworks/soc2.md', 'utf8'),
} satisfies Record<(typeof frameworks)[number]['id'], string>;

describe('compliance catalogue', () => {
  it('requires unique IDs, valid mappings, owners and reviewable evidence', () => {
    expect(new Set(complianceControls.map(c => c.id)).size).toBe(complianceControls.length);
    for (const c of complianceControls) {
      expect(c.id).toMatch(/^[A-Z]+-[A-Z0-9-]+$/);
      expect(['IMPLEMENTED', 'PARTIAL', 'MISSING']).toContain(c.status);
      expect(['MAINTAINER', 'OPERATOR', 'ORGANIZATION']).toContain(c.owner);
      expect(c.implementation.length).toBeGreaterThan(20);
      expect(c.frameworks.length).toBeGreaterThan(0);
      expect(c.evidence.length).toBeGreaterThan(0);
      for (const f of c.frameworks) expect(frameworks.map(v => v.id)).toContain(f);
      for (const p of c.evidence) {
        expect(p).not.toMatch(/(^\/|\.\.|https?:)/);
        expect(repositoryFiles.has(p), `${c.id}: ${p}`).toBe(true);
      }
      if (c.status !== 'IMPLEMENTED') expect(c.gaps.length).toBeGreaterThan(0);
    }
    expect(complianceEvidence.map(e => e.controlId)).toEqual(complianceControls.map(c => c.id));
  });

  it('counts the curated scope without treating partial controls as implemented', () => {
    const sample = complianceControls.filter(c =>
      ['SEC-AUTH-001', 'SEC-ENC-001', 'PRIV-001'].includes(c.id)
    );
    expect(getReadiness(undefined, sample)).toEqual({ IMPLEMENTED: 1, PARTIAL: 1, MISSING: 1 });
    expect(getReadiness('CRA', sample)).toEqual({ IMPLEMENTED: 1, PARTIAL: 1, MISSING: 0 });
    expect(getReadiness(undefined, [])).toEqual({ IMPLEMENTED: 0, PARTIAL: 0, MISSING: 0 });
    expect(Object.values(getReadiness()).reduce((a, b) => a + b, 0)).toBe(
      complianceControls.length
    );
  });

  it('keeps framework pages linked to the mapped controls', () => {
    for (const f of frameworks) {
      const doc = frameworkDocuments[f.id];
      for (const c of complianceControls.filter(c => c.frameworks.some(id => id === f.id))) {
        expect(doc).toContain(c.id);
      }
    }
    expect(evidenceSourceUrl('docs/a b.md')).toBe(
      'https://github.com/opsknight-labs/OpsKnight/blob/main/docs/a%20b.md'
    );
  });
});
