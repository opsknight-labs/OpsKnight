import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type {
  EvidencePackageScope,
  EvidenceSelection,
  EvidencePackageFileEntry,
  ExportedControlSnapshot,
} from './types';
import type { AuditSnapshotData } from './snapshot';
import type { CollectedExportEvidence } from './evidence';
import { canonicalSerializeJson } from './serializer';
import { generateControlsCsv, generateFrameworksCsv, generateEvidenceIndexCsv } from './csv';
import { generatePackageReadme, generateSummaryReport } from './markdown';
import { buildEvidencePackageManifest, type BuiltManifestResult } from './manifest';
import {
  computeComplianceControlRegistryFingerprint,
  computeFrameworkMappingFingerprint,
} from '../fingerprint';

export interface StagedPackageFile {
  readonly path: string;
  readonly mediaType: string;
  readonly buffer: Buffer;
}

export interface GeneratedPackageResult {
  readonly packageId: string;
  readonly filename: string;
  readonly zipBuffer: Buffer;
  readonly manifestResult: BuiltManifestResult;
  readonly counts: {
    readonly controls: number;
    readonly requirements: number;
    readonly evidence: number;
    readonly integrityMismatches: number;
  };
}

export function sanitizePath(path: string): string {
  if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
    throw new Error(`Insecure file path in evidence package: ${path}`);
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(path)) {
    throw new Error(`Invalid characters in evidence package file path: ${path}`);
  }
  return path;
}

export function generatePackageFilename(scope: EvidencePackageScope, snapshotAt: string): string {
  let scopeTag = 'deployment';
  if (scope.type === 'FRAMEWORK') {
    scopeTag = `framework-${scope.framework.toLowerCase()}`;
  } else if (scope.type === 'CONTROLS') {
    scopeTag = `controls-${scope.controlIds.length}`;
  }

  const cleanTime = snapshotAt.replace(/[:.]/g, '-');
  return `opsknight-evidence-package-${scopeTag}-${cleanTime}.zip`;
}

export async function buildEvidencePackageZip(params: {
  readonly packageId: string;
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly snapshot: AuditSnapshotData;
  readonly evidence: CollectedExportEvidence;
  readonly userId: string;
  readonly productVersion?: string;
}): Promise<GeneratedPackageResult> {
  const stagedFiles: StagedPackageFile[] = [];
  const version = params.productVersion ?? '2.0.0';
  const generatedAt = new Date().toISOString();

  function stageFile(path: string, mediaType: string, buffer: Buffer) {
    stagedFiles.push({
      path: sanitizePath(path),
      mediaType,
      buffer,
    });
  }

  // 1. Controls with evidence counts updated
  const controlsWithCounts: ExportedControlSnapshot[] = params.snapshot.controls.map(c => ({
    ...c,
    evidenceCount: params.evidence.evidenceByControl.get(c.controlId)?.length ?? 0,
  }));

  // 2. Summary CSV files
  const controlsCsv = generateControlsCsv(controlsWithCounts);
  stageFile('summary/controls.csv', 'text/csv', Buffer.from(controlsCsv, 'utf8'));

  const frameworksCsv = generateFrameworksCsv(
    params.snapshot.requirements,
    params.snapshot.requirements.flatMap(r =>
      r.mappedControls.map(m => ({
        id: `${r.requirementId}:${m.controlId}`,
        framework: r.framework,
        requirementId: r.requirementId,
        controlId: m.controlId,
        relationship: m.relationship,
        evidenceExpectation: 'RUNTIME' as const,
        rationale: 'Observed technical telemetry and system configuration',
      }))
    )
  );
  stageFile('summary/frameworks.csv', 'text/csv', Buffer.from(frameworksCsv, 'utf8'));

  const evidenceIndexCsv = generateEvidenceIndexCsv(params.evidence.evidenceRecords);
  stageFile('summary/evidence-index.csv', 'text/csv', Buffer.from(evidenceIndexCsv, 'utf8'));

  // 3. Summary control-center JSON
  const controlCenterSummary = {
    generatedAt,
    snapshotAt: params.snapshot.snapshotAt,
    scope: params.scope,
    controlsCount: controlsWithCounts.length,
    statusCounts: (() => {
      const counts = new Map<string, number>();
      for (const c of controlsWithCounts) {
        const s = c.resolvedCurrentState ?? 'UNVERIFIED';
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      return Object.fromEntries(counts.entries());
    })(),
    evidenceCount: params.evidence.totalCount,
    integrityMismatches: params.evidence.integrityMismatchesCount,
  };
  stageFile(
    'summary/control-center.json',
    'application/json',
    canonicalSerializeJson(controlCenterSummary)
  );

  // 4. Individual Controls, Evaluations, and Evidence
  const evalById = new Map(params.snapshot.evaluations.map(e => [e.controlId, e]));

  for (const control of controlsWithCounts) {
    stageFile(
      `controls/${control.controlId}/control.json`,
      'application/json',
      canonicalSerializeJson(control)
    );

    const evaluation = evalById.get(control.controlId);
    if (evaluation) {
      stageFile(
        `controls/${control.controlId}/evaluation.json`,
        'application/json',
        canonicalSerializeJson(evaluation)
      );
    }

    const controlEvidence = params.evidence.evidenceByControl.get(control.controlId) ?? [];
    for (const ev of controlEvidence) {
      stageFile(
        `controls/${control.controlId}/evidence/${ev.id}.json`,
        'application/json',
        canonicalSerializeJson(ev)
      );
    }
  }

  // 5. Individual Frameworks, Requirements, and Mappings
  for (const fw of params.snapshot.frameworks) {
    stageFile(`frameworks/${fw.id}/framework.json`, 'application/json', canonicalSerializeJson(fw));

    const fwReqs = params.snapshot.requirements.filter(r => r.framework === fw.id);
    stageFile(
      `frameworks/${fw.id}/requirements.json`,
      'application/json',
      canonicalSerializeJson(fwReqs)
    );

    const fwMappings = fwReqs.flatMap(r =>
      r.mappedControls.map(m => ({
        requirementId: r.requirementId,
        controlId: m.controlId,
        relationship: m.relationship,
      }))
    );
    stageFile(
      `frameworks/${fw.id}/mappings.json`,
      'application/json',
      canonicalSerializeJson(fwMappings)
    );
  }

  // 6. Compute preliminary file entries to build manifest
  const fileEntries: EvidencePackageFileEntry[] = stagedFiles.map(f => ({
    path: f.path,
    mediaType: f.mediaType,
    sizeBytes: f.buffer.byteLength,
    sha256: createHash('sha256').update(f.buffer).digest('hex'),
  }));

  const counts = {
    controls: controlsWithCounts.length,
    requirements: params.snapshot.requirements.length,
    evidence: params.evidence.totalCount,
    integrityMismatches: params.evidence.integrityMismatchesCount,
  };

  const controlRegistryFingerprint = computeComplianceControlRegistryFingerprint();
  const frameworkMappingFingerprint = computeFrameworkMappingFingerprint();

  // 7. Human-readable Markdown files
  const warnings: string[] = [];
  if (counts.integrityMismatches > 0) {
    warnings.push(
      `${counts.integrityMismatches} evidence record(s) failed their stored SHA-256 integrity check and are flagged as MISMATCH.`
    );
  }

  const manifestDraft = {
    schemaVersion: '1' as const,
    packageId: params.packageId,
    generatedAt,
    snapshotAt: params.snapshot.snapshotAt,
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    product: { name: 'OpsKnight' as const, version },
    fingerprints: {
      controlRegistry: controlRegistryFingerprint,
      frameworkMappings: frameworkMappingFingerprint,
    },
    frameworks: params.snapshot.frameworks.map(f => ({ id: f.id, version: f.version })),
    counts,
    files: fileEntries,
    generatedBy: { userId: params.userId },
  };

  const readmeContent = generatePackageReadme(manifestDraft, warnings);
  const reportContent = generateSummaryReport(manifestDraft, controlsWithCounts);

  const readmeBuffer = Buffer.from(readmeContent, 'utf8');
  const reportBuffer = Buffer.from(reportContent, 'utf8');

  stageFile('README.md', 'text/markdown', readmeBuffer);
  stageFile('summary/report.md', 'text/markdown', reportBuffer);

  // Re-calculate full file entries list including README and report
  const allStagedEntries: EvidencePackageFileEntry[] = stagedFiles.map(f => ({
    path: f.path,
    mediaType: f.mediaType,
    sizeBytes: f.buffer.byteLength,
    sha256: createHash('sha256').update(f.buffer).digest('hex'),
  }));

  // 8. Authoritative Manifest and SHA-256 Checksums
  const manifestResult = buildEvidencePackageManifest({
    packageId: params.packageId,
    generatedAt,
    snapshotAt: params.snapshot.snapshotAt,
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    productVersion: version,
    controlRegistryFingerprint,
    frameworkMappingFingerprint,
    frameworks: params.snapshot.frameworks,
    counts,
    files: allStagedEntries,
    userId: params.userId,
  });

  // 9. Assemble ZIP Archive
  const zip = new JSZip();

  for (const file of stagedFiles) {
    zip.file(file.path, file.buffer);
  }

  zip.file('integrity/sha256sums.txt', manifestResult.sha256sumsContent);
  zip.file('manifest.json', manifestResult.manifestBuffer);
  zip.file('manifest.sha256', manifestResult.manifestSha256Content);

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const filename = generatePackageFilename(params.scope, params.snapshot.snapshotAt);

  return {
    packageId: params.packageId,
    filename,
    zipBuffer,
    manifestResult,
    counts,
  };
}
