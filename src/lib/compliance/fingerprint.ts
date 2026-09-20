import { createHash } from 'node:crypto';
import { complianceControls } from './controls';
import { getComplianceEvaluator } from './evaluators';
import { toCanonicalJson } from './evidence/canonicalize';
import { computeFrameworkMappingFingerprint } from './framework-mappings/fingerprint';

export { computeFrameworkMappingFingerprint };

/**
 * Computes a deterministic SHA-256 fingerprint across all registered compliance controls,
 * their assessment modes, ownership, evaluator bindings/versions, and catalog statuses.
 *
 * Any alteration to control definitions, titles, evaluator versions, or repository statuses
 * causes this fingerprint to change.
 */
export function computeComplianceControlRegistryFingerprint(): string {
  const sortedControls = [...complianceControls]
    .map(c => ({
      id: c.id,
      title: c.title,
      assessmentMode: c.assessmentMode,
      owner: c.owner,
      evaluatorId: c.evaluatorId ?? null,
      evaluatorVersion: c.evaluatorId
        ? (getComplianceEvaluator(c.evaluatorId)?.version ?? null)
        : null,
      repositoryStatus: c.catalogStatus ?? c.status,
      implementation: c.implementation,
      gaps: [...c.gaps].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const payload = {
    schemaVersion: '1.0.0',
    controls: sortedControls,
  };

  const canonicalJson = toCanonicalJson(payload);
  const hash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

export const computeControlRegistryFingerprint = computeComplianceControlRegistryFingerprint;
