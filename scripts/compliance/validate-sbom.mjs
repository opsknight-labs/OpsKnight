import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import addInternationalFormats from 'ajv-formats-draft2019';

// Vendored, reviewed schemas only. No network resolution of SBOM-controlled URLs.
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
addInternationalFormats(ajv);
for (const name of ['spdx.schema.json', 'jsf-0.82.schema.json']) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed schema allowlist.
  ajv.addSchema(JSON.parse(readFileSync(new URL(`./schemas/${name}`, import.meta.url), 'utf8')));
}
const validate = ajv.compile(
  JSON.parse(readFileSync(new URL('./schemas/bom-1.5.schema.json', import.meta.url), 'utf8'))
);

export function validateSbom(bom, pkg) {
  if (bom?.bomFormat !== 'CycloneDX' || bom?.specVersion !== '1.5') {
    throw new Error('SBOM must declare CycloneDX 1.5');
  }
  if (!validate(bom))
    throw new Error(`Invalid CycloneDX 1.5 SBOM: ${ajv.errorsText(validate.errors)}`);
  const root = bom.metadata?.component;
  if (root?.name !== pkg.name || root?.version !== pkg.version) {
    throw new Error('SBOM product name/version does not match package.json');
  }
  if (!root?.['bom-ref'] || !root?.purl) throw new Error('SBOM product metadata is incomplete');
  if (!Array.isArray(bom.components) || bom.components.length === 0)
    throw new Error('SBOM has no components');
  const refs = new Set([root['bom-ref']]);
  for (const component of bom.components) {
    if (
      !component.name?.trim() ||
      !component.version?.trim() ||
      !component.purl ||
      !component['bom-ref']
    ) {
      throw new Error('SBOM package metadata is incomplete');
    }
    if (refs.has(component['bom-ref'])) throw new Error('Duplicate SBOM component reference');
    refs.add(component['bom-ref']);
  }
  if (!bom.dependencies?.some(dependency => dependency.ref === root['bom-ref'])) {
    throw new Error('SBOM product dependency graph is missing');
  }
  for (const dependency of bom.dependencies) {
    if (!refs.has(dependency.ref) || dependency.dependsOn?.some(ref => !refs.has(ref))) {
      throw new Error('SBOM dependency refers to an unknown component');
    }
  }
  return { name: root.name, version: root.version, componentCount: bom.components.length };
}

export function describeSbom(raw, pkg, commit, ref) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('A full source commit SHA is required');
  const summary = validateSbom(JSON.parse(raw), pkg);
  if (ref?.startsWith('refs/tags/v') && ref.slice('refs/tags/v'.length) !== pkg.version) {
    throw new Error('Release tag does not match package.json version');
  }
  return {
    ...summary,
    sourceCommit: commit,
    sourceRef: ref || null,
    scope: 'npm production dependency inventory from package-lock.json; not the final container',
    format: 'CycloneDX 1.5',
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
}

/** Convert npm's git transport spelling into the equivalent schema-valid HTTPS URL. */
export function normalizeSbomExternalReferences(value) {
  if (Array.isArray(value)) return value.map(normalizeSbomExternalReferences);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === 'url' && typeof child === 'string' && child.startsWith('git+https://')
        ? child.slice(4)
        : normalizeSbomExternalReferences(child),
    ])
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Maintainer CLI argument, not a web endpoint.
    const sbomPath = process.argv[2] || 'reports/source-sbom.cdx.json';
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Maintainer CLI argument, not a web endpoint.
    const generated = JSON.parse(readFileSync(sbomPath, 'utf8'));
    const raw = `${JSON.stringify(normalizeSbomExternalReferences(generated), null, 2)}\n`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Same explicitly selected artifact path.
    writeFileSync(sbomPath, raw);
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    console.log(
      JSON.stringify(
        describeSbom(raw, pkg, process.env.SBOM_SOURCE_SHA, process.env.SBOM_SOURCE_REF),
        null,
        2
      )
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'SBOM validation failed');
    process.exitCode = 1;
  }
}
