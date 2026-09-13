// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  describeSbom,
  normalizeSbomExternalReferences,
  validateSbom,
} from '../../scripts/compliance/validate-sbom.mjs';

const pkg = { name: 'opsknight', version: '1.4.0' };
function fixture() {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: pkg.name,
        version: pkg.version,
        purl: 'pkg:npm/opsknight@1.4.0',
        'bom-ref': 'root',
      },
    },
    components: [
      {
        type: 'library',
        name: 'example',
        version: '1.0.0',
        purl: 'pkg:npm/example@1.0.0',
        'bom-ref': 'dependency',
      },
    ],
    dependencies: [{ ref: 'root', dependsOn: ['dependency'] }],
  };
}

describe('source SBOM validation', () => {
  it('validates schema, product identity, graph and exact artifact bytes', () => {
    const raw = JSON.stringify(fixture());
    expect(validateSbom(JSON.parse(raw), pkg).componentCount).toBe(1);
    const manifest = describeSbom(raw, pkg, 'a'.repeat(40), 'refs/tags/v1.4.0');
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.sha256).not.toBe(describeSbom(raw + '\n', pkg, 'a'.repeat(40), '').sha256);
  });
  it('rejects invalid schema even when product identity is correct', () => {
    expect(() => validateSbom({ ...fixture(), unexpected: true }, pkg)).toThrow(
      'Invalid CycloneDX'
    );
    expect(() => validateSbom({ ...fixture(), specVersion: 'invalid' }, pkg)).toThrow();
    expect(() => validateSbom({ ...fixture(), version: -1 }, pkg)).toThrow();
  });
  it('rejects empty, incomplete and misidentified inventories', () => {
    expect(() => validateSbom({ ...fixture(), components: [] }, pkg)).toThrow('no components');
    expect(() => validateSbom(fixture(), { ...pkg, version: '9.0.0' })).toThrow('does not match');
    const bom = fixture();
    bom.components[0].version = '';
    expect(() => validateSbom(bom, pkg)).toThrow('metadata');
  });
  it('rejects broken graph references, duplicate identities and absent roots', () => {
    const broken = fixture();
    broken.dependencies[0].dependsOn = ['unknown'];
    expect(() => validateSbom(broken, pkg)).toThrow('unknown component');
    const duplicate = fixture();
    duplicate.components.push({ ...duplicate.components[0] });
    expect(() => validateSbom(duplicate, pkg)).toThrow(/duplicate/i);
    expect(() => validateSbom({ ...fixture(), dependencies: [] }, pkg)).toThrow('graph');
  });
  it('rejects malformed JSON, absent commit and mismatched release tag', () => {
    expect(() => describeSbom('{', pkg, 'a'.repeat(40), '')).toThrow();
    expect(() => describeSbom(JSON.stringify(fixture()), pkg, '', '')).toThrow('commit');
    expect(() =>
      describeSbom(JSON.stringify(fixture()), pkg, 'a'.repeat(40), 'refs/tags/v2.0.0')
    ).toThrow('tag');
  });

  it('canonicalizes npm git transport URLs without changing ordinary values', () => {
    const normalized = normalizeSbomExternalReferences({
      externalReferences: [
        { type: 'vcs', url: 'git+https://github.com/example/project.git' },
        { type: 'website', url: 'https://example.com' },
      ],
    });
    expect(normalized.externalReferences[0].url).toBe('https://github.com/example/project.git');
    expect(normalized.externalReferences[1].url).toBe('https://example.com');
  });
});
