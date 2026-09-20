import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type {
  EvidencePackageManifest,
  PackageVerificationResult,
  PackageVerificationMismatch,
} from './types';

/**
 * Independently verifies that an OpsKnight evidence package ZIP has not been modified or corrupted:
 * 1. Checks that manifest.json and manifest.sha256 exist.
 * 2. Recomputes SHA-256 digest of manifest.json and checks against manifest.sha256.
 * 3. Recomputes SHA-256 and byte sizes of every entry listed in manifest.files.
 * 4. Checks for unlisted files or missing entries.
 */
export async function verifyEvidencePackageManifest(
  zipInput: Buffer | ArrayBuffer | Uint8Array
): Promise<PackageVerificationResult> {
  const mismatches: PackageVerificationMismatch[] = [];
  const warnings: string[] = [];

  const zip = await JSZip.loadAsync(zipInput);

  const manifestFile = zip.file('manifest.json');
  const manifestSha256File = zip.file('manifest.sha256');

  if (!manifestFile || !manifestSha256File) {
    return {
      valid: false,
      packageId: 'unknown',
      manifestValid: false,
      entriesTotal: 0,
      entriesVerified: 0,
      mismatches: [
        {
          path: !manifestFile ? 'manifest.json' : 'manifest.sha256',
          reason: 'MISSING',
        },
      ],
      warnings: ['Missing manifest or manifest checksum file in root of archive.'],
    };
  }

  const manifestBuffer = await manifestFile.async('nodebuffer');
  const manifestSha256Text = (await manifestSha256File.async('text')).trim();
  const expectedManifestHash = manifestSha256Text.split(/\s+/)[0];

  const calculatedManifestHash = createHash('sha256').update(manifestBuffer).digest('hex');

  let manifestValid = true;
  if (calculatedManifestHash !== expectedManifestHash) {
    manifestValid = false;
    mismatches.push({
      path: 'manifest.json',
      reason: 'HASH_MISMATCH',
      expectedHash: expectedManifestHash,
      actualHash: calculatedManifestHash,
    });
  }

  let manifest: EvidencePackageManifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8')) as EvidencePackageManifest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      packageId: 'unknown',
      manifestValid: false,
      entriesTotal: 0,
      entriesVerified: 0,
      mismatches: [
        {
          path: 'manifest.json',
          reason: 'HASH_MISMATCH',
        },
      ],
      warnings: [`Failed to parse manifest.json: ${message}`],
    };
  }

  if (manifest.schemaVersion !== '1') {
    warnings.push(`Unexpected manifest schema version: ${manifest.schemaVersion}`);
  }

  if (manifest.counts?.integrityMismatches > 0) {
    warnings.push(
      `Package manifest notes ${manifest.counts.integrityMismatches} evidence record(s) failed runtime SHA-256 integrity verification.`
    );
  }

  const listedPaths = new Set<string>();
  let entriesVerified = 0;

  for (const entry of manifest.files) {
    listedPaths.add(entry.path);
    const file = zip.file(entry.path);

    if (!file) {
      mismatches.push({
        path: entry.path,
        reason: 'MISSING',
        expectedHash: entry.sha256,
        expectedSize: entry.sizeBytes,
      });
      continue;
    }

    const buffer = await file.async('nodebuffer');
    const actualSize = buffer.byteLength;
    const actualHash = createHash('sha256').update(buffer).digest('hex');

    if (actualSize !== entry.sizeBytes) {
      mismatches.push({
        path: entry.path,
        reason: 'SIZE_MISMATCH',
        expectedSize: entry.sizeBytes,
        actualSize,
      });
      continue;
    }

    if (actualHash !== entry.sha256) {
      mismatches.push({
        path: entry.path,
        reason: 'HASH_MISMATCH',
        expectedHash: entry.sha256,
        actualHash,
      });
      continue;
    }

    entriesVerified++;
  }

  // Check for any unlisted files in the ZIP (excluding manifest.json, manifest.sha256, and integrity/sha256sums.txt)
  const ignoredRootFiles = new Set([
    'manifest.json',
    'manifest.sha256',
    'integrity/sha256sums.txt',
  ]);

  zip.forEach((relativePath, file) => {
    if (file.dir) {
      return;
    }
    if (ignoredRootFiles.has(relativePath)) {
      return;
    }
    if (!listedPaths.has(relativePath)) {
      mismatches.push({
        path: relativePath,
        reason: 'UNLISTED_FILE',
      });
    }
  });

  const valid = manifestValid && mismatches.length === 0;

  return {
    valid,
    packageId: manifest.packageId,
    manifestValid,
    entriesTotal: manifest.files.length,
    entriesVerified,
    mismatches,
    warnings,
  };
}

export const verifyComplianceEvidencePackageManifest = verifyEvidencePackageManifest;
