import type { EvidencePackageManifest, ExportedControlSnapshot } from './types';

export function generatePackageReadme(
  manifest: EvidencePackageManifest,
  warnings: readonly string[] = []
): string {
  const scopeSummary =
    manifest.scope.type === 'DEPLOYMENT'
      ? 'All deployment controls and framework mappings'
      : manifest.scope.type === 'FRAMEWORK'
        ? `Framework: ${manifest.scope.framework}`
        : `Selected controls: ${manifest.scope.controlIds.join(', ')}`;

  const evidenceSummary =
    manifest.evidenceSelection.mode === 'SNAPSHOT'
      ? 'Latest supporting evidence snapshot per control'
      : `Historical evidence from ${manifest.evidenceSelection.from} to ${manifest.evidenceSelection.to}`;

  const warningSection =
    warnings.length > 0
      ? `## ⚠️ Integrity Warnings\n${warnings.map(w => `- ${w}`).join('\n')}\n\n`
      : '';

  return `# OpsKnight Compliance Evidence Package

## Important Notice & Non-Certification Scope
> **Notice**: This package contains technical control observations and supporting evidence captured by OpsKnight.
> Framework mappings indicate potentially relevant supporting technical evidence and do not constitute legal advice, certification, audit opinion, or determination of compliance.
> OpsKnight does not certify deployments, systems, or organizations.

${warningSection}## Package Metadata
- **Package ID**: \`${manifest.packageId}\`
- **Generated At**: ${manifest.generatedAt}
- **Snapshot Boundary**: ${manifest.snapshotAt}
- **Product**: ${manifest.product.name} v${manifest.product.version}
- **Scope**: ${scopeSummary}
- **Evidence Selection**: ${evidenceSummary}
- **Controls Included**: ${manifest.counts.controls}
- **Framework Requirements**: ${manifest.counts.requirements}
- **Evidence Records**: ${manifest.counts.evidence}
- **Evidence Integrity Mismatches**: ${manifest.counts.integrityMismatches}

## Registry Fingerprints
- **Control Registry Fingerprint**: \`${manifest.fingerprints.controlRegistry}\`
- **Framework Mapping Fingerprint**: \`${manifest.fingerprints.frameworkMappings}\`

## Directory Structure
- \`manifest.json\`: Authoritative package manifest with file entry digests
- \`manifest.sha256\`: SHA-256 digest of manifest.json
- \`README.md\`: Package metadata, scope, and verification instructions
- \`integrity/sha256sums.txt\`: Checksum listing for all exported files
- \`summary/\`: Human-readable reports and CSV indices
  - \`report.md\`: Formatted breakdown of controls and framework mappings
  - \`controls.csv\`: Tabular index of controls and resolved runtime states
  - \`frameworks.csv\`: Tabular index of framework requirements and control mappings
  - \`evidence-index.csv\`: Tabular index of evidence records and integrity verification results
  - \`control-center.json\`: High-level posture snapshot
- \`controls/<control-id>/\`: Individual control definitions, runtime states, evaluations, and evidence
- \`frameworks/<framework>/\`: Framework definitions, requirements, and mappings

## Independent Package Verification
To verify the integrity of this package using standard command-line tools:

\`\`\`bash
# 1. Verify file entry checksums
shasum -a 256 -c integrity/sha256sums.txt

# 2. Verify package manifest checksum
shasum -a 256 -c manifest.sha256
\`\`\`
`;
}

export function generateSummaryReport(
  manifest: EvidencePackageManifest,
  controls: readonly ExportedControlSnapshot[]
): string {
  const controlRows = controls
    .map(
      c =>
        `| \`${c.controlId}\` | ${c.title} | ${c.assessmentMode} | ${c.owner} | \`${c.resolvedCurrentState ?? 'UNVERIFIED'}\` | ${c.evidenceCount} |`
    )
    .join('\n');

  return `# Compliance Evidence Package Summary Report

## Package Context
- **Package ID**: \`${manifest.packageId}\`
- **Generated At**: ${manifest.generatedAt}
- **Snapshot Cutoff**: ${manifest.snapshotAt}
- **Scope**: ${manifest.scope.type}

## Controls Summary
| Control ID | Title | Assessment Mode | Owner | Resolved Status | Evidence Count |
| :--- | :--- | :--- | :--- | :--- | :--- |
${controlRows}

## Observation & Assessment Caveat
Technical control status reflects observed conditions at the snapshot boundary (\`${manifest.snapshotAt}\`).
Controls with status \`UNVERIFIED\` indicate that evaluation validity expired or evaluator version changed since the last execution.
This report is informational and should be evaluated alongside operational policies and organizational governance.
`;
}
