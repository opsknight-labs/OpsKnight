import { createHash } from 'node:crypto';
import { COMPLIANCE_FRAMEWORK_DEFINITIONS } from './frameworks';
import { ALL_FRAMEWORK_REQUIREMENTS } from './requirements';
import { ALL_FRAMEWORK_CONTROL_MAPPINGS } from './mappings';
import { toCanonicalJson } from '../evidence/canonicalize';

/**
 * Computes a deterministic SHA-256 fingerprint across all registered framework definitions,
 * requirements, and control mappings.
 *
 * Any alteration to framework versions, requirement references, lifecycles, control IDs,
 * relationships, or evidence expectations causes this fingerprint to change.
 */
export function computeFrameworkMappingFingerprint(): string {
  const sortedFrameworks = [...COMPLIANCE_FRAMEWORK_DEFINITIONS].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const sortedRequirements = [...ALL_FRAMEWORK_REQUIREMENTS]
    .map(r => ({
      id: r.id,
      framework: r.framework,
      reference: r.reference,
      title: r.title,
      summary: r.summary,
      sourceUrl: r.sourceUrl,
      lifecycle: r.lifecycle,
      applicability: r.applicability,
      effectiveFrom: r.effectiveFrom ?? null,
      effectiveUntil: r.effectiveUntil ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const sortedMappings = [...ALL_FRAMEWORK_CONTROL_MAPPINGS]
    .map(m => ({
      id: m.id,
      framework: m.framework,
      requirementId: m.requirementId,
      controlId: m.controlId,
      relationship: m.relationship,
      evidenceExpectation: m.evidenceExpectation,
      rationale: m.rationale,
      notes: m.notes ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const payload = {
    schemaVersion: '1.0.0',
    frameworks: sortedFrameworks,
    requirements: sortedRequirements,
    mappings: sortedMappings,
  };

  const canonicalJson = toCanonicalJson(payload);
  const hash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
