import { describe, expect, it } from 'vitest';
import { resolveExportScope, UnknownControlIdError } from '@/lib/compliance/export/scope';
import { complianceControls } from '@/lib/compliance/controls';

describe('resolveExportScope', () => {
  it('resolves deployment scope to all registered controls and frameworks', () => {
    const resolved = resolveExportScope({ type: 'DEPLOYMENT' });
    expect(resolved.controls.length).toBe(complianceControls.length);
    expect(resolved.frameworks.length).toBeGreaterThanOrEqual(7);
    expect(resolved.requirements.length).toBeGreaterThan(0);
    expect(resolved.mappings.length).toBeGreaterThan(0);
  });

  it('resolves GDPR framework scope with only relevant requirements and mapped controls', () => {
    const resolved = resolveExportScope({ type: 'FRAMEWORK', framework: 'GDPR' });
    expect(resolved.frameworks.length).toBe(1);
    expect(resolved.frameworks[0].id).toBe('GDPR');
    expect(resolved.requirements.every(r => r.framework === 'GDPR')).toBe(true);
    expect(resolved.controls.some(c => c.id === 'SEC-ENC-001')).toBe(true);
  });

  it('preserves FUTURE lifecycle for CRA requirements', () => {
    const resolved = resolveExportScope({ type: 'FRAMEWORK', framework: 'CRA' });
    const futureReqs = resolved.requirements.filter(r => r.lifecycle === 'FUTURE');
    expect(futureReqs.length).toBeGreaterThan(0);
  });

  it('preserves SUPERSEDED lifecycle for ISO27701 requirements', () => {
    const resolved = resolveExportScope({ type: 'FRAMEWORK', framework: 'ISO27701' });
    const supersededReqs = resolved.requirements.filter(r => r.lifecycle === 'SUPERSEDED');
    expect(supersededReqs.length).toBeGreaterThan(0);
  });

  it('resolves selected controls and throws on unknown control ID', () => {
    const resolved = resolveExportScope({
      type: 'CONTROLS',
      controlIds: ['SEC-ENC-001', 'SEC-AUTHZ-001'],
    });
    expect(resolved.controls.map(c => c.id)).toEqual(['SEC-AUTHZ-001', 'SEC-ENC-001']);

    expect(() =>
      resolveExportScope({
        type: 'CONTROLS',
        controlIds: ['NON-EXISTENT-CONTROL'],
      })
    ).toThrow(UnknownControlIdError);
  });

  it('rejects duplicate control IDs in resolveExportScope and validation schema', () => {
    expect(() =>
      resolveExportScope({
        type: 'CONTROLS',
        controlIds: ['SEC-ENC-001', 'SEC-ENC-001'],
      })
    ).toThrow('Duplicate control IDs are not permitted');
  });
});
