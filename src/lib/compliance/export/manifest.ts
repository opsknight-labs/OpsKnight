import { createHash } from 'node:crypto';
import type {
  EvidencePackageManifest,
  EvidencePackageScope,
  EvidenceSelection,
  EvidencePackageFileEntry,
  ExportedFrameworkDefinition,
} from './types';
import { canonicalSerializeJson } from './serializer';

export interface BuildManifestParams {
  readonly packageId: string;
  readonly generatedAt: string;
  readonly snapshotAt: string;
  readonly scope: EvidencePackageScope;
  readonly evidenceSelection: EvidenceSelection;
  readonly productVersion: string;
  readonly buildId?: string;
  readonly controlRegistryFingerprint: string;
  readonly frameworkMappingFingerprint: string;
  readonly frameworks: readonly ExportedFrameworkDefinition[];
  readonly counts: {
    readonly controls: number;
    readonly requirements: number;
    readonly evidence: number;
    readonly integrityMismatches: number;
  };
  readonly files: readonly EvidencePackageFileEntry[];
  readonly userId: string;
}

export interface BuiltManifestResult {
  readonly manifest: EvidencePackageManifest;
  readonly manifestBuffer: Buffer;
  readonly manifestSha256: string;
  readonly manifestSha256Content: string;
}

export function buildEvidencePackageManifest(params: BuildManifestParams): BuiltManifestResult {
  const sortedFiles = [...params.files].sort((a, b) => a.path.localeCompare(b.path));

  const manifest: EvidencePackageManifest = {
    schemaVersion: '1',
    packageId: params.packageId,
    generatedAt: params.generatedAt,
    snapshotAt: params.snapshotAt,
    scope: params.scope,
    evidenceSelection: params.evidenceSelection,
    product: {
      name: 'OpsKnight',
      version: params.productVersion,
      ...(params.buildId ? { buildId: params.buildId } : {}),
    },
    fingerprints: {
      controlRegistry: params.controlRegistryFingerprint,
      frameworkMappings: params.frameworkMappingFingerprint,
    },
    frameworks: params.frameworks.map(fw => ({
      id: fw.id,
      version: fw.version,
    })),
    counts: params.counts,
    files: sortedFiles,
    generatedBy: {
      userId: params.userId,
    },
  };

  const manifestBuffer = canonicalSerializeJson(manifest);
  const manifestSha256 = createHash('sha256').update(manifestBuffer).digest('hex');
  const manifestSha256Content = `${manifestSha256}  manifest.json\n`;

  return {
    manifest,
    manifestBuffer,
    manifestSha256,
    manifestSha256Content,
  };
}
