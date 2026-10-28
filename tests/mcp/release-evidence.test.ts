import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { REQUIRED_GATES, validateEvidence, loadEvidenceFile } = createRequire(import.meta.url)(
  '../../scripts/mcp/certify.cjs'
) as {
  REQUIRED_GATES: string[];
  validateEvidence(evidence: unknown, revision: string, now?: Date): string[];
  loadEvidenceFile(evidencePath: string, repositoryRoot?: string): unknown;
};

const revision = 'a'.repeat(40);
const now = new Date('2026-10-28T12:00:00.000Z');
const goodEvidence = () => ({
  schemaVersion: 1,
  sourceRevision: revision,
  imageDigest: 'sha256:' + 'b'.repeat(64),
  imageSourceRevision: revision,
  imageProvenanceUrl: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/123',
  review: {
    reviewedBy: 'maintainer',
    reviewedAt: '2026-10-28T11:00:00.000Z',
    referenceUrl: 'https://github.com/opsknight-labs/OpsKnight/pull/924',
  },
  gates: Object.fromEntries(
    REQUIRED_GATES.map(gate => [
      gate,
      {
        status: 'passed',
        sourceRevision: revision,
        artifactUrls: ['https://artifacts.example.com/mcp/' + gate + '.json'],
      },
    ])
  ),
});

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('MCP release evidence gate', () => {
  it('accepts a complete, reviewed manifest tied to the exact source and image revision', () => {
    expect(validateEvidence(goodEvidence(), revision, now)).toEqual([]);
  });

  it('rejects stale source or image revisions and malformed image digests', () => {
    const evidence = goodEvidence();
    evidence.sourceRevision = 'c'.repeat(40);
    evidence.imageSourceRevision = 'd'.repeat(40);
    evidence.imageDigest = 'sha256:bad';
    expect(validateEvidence(evidence, revision, now)).toEqual(
      expect.arrayContaining(['sourceRevision', 'imageSourceRevision', 'imageDigest'])
    );
  });

  it('requires every known gate and rejects unknown or misspelled gate names', () => {
    const evidence = goodEvidence();
    delete (evidence.gates as Record<string, unknown>).durableTasks;
    (evidence.gates as Record<string, unknown>).durableTask = {
      status: 'passed',
      sourceRevision: revision,
      artifactUrls: ['https://artifacts.example.com/durableTask.json'],
    };
    expect(validateEvidence(evidence, revision, now)).toEqual(
      expect.arrayContaining(['gates.durableTasks', 'gates.unknown:durableTask'])
    );
  });

  it('rejects pending gate status, stale gate evidence and missing artifact links', () => {
    const evidence = goodEvidence();
    const gates = evidence.gates as Record<string, Record<string, unknown>>;
    gates.protocol.status = 'pending';
    gates.oauth.sourceRevision = 'e'.repeat(40);
    gates.rbac.artifactUrls = [];
    expect(validateEvidence(evidence, revision, now)).toEqual(
      expect.arrayContaining([
        'gates.protocol.status',
        'gates.oauth.sourceRevision',
        'gates.rbac.artifactUrls',
      ])
    );
  });

  it('rejects malformed, non-HTTPS, credential-bearing, local and fragment URLs', () => {
    for (const url of [
      'https://',
      'http://artifacts.example.com/a.json',
      'https://user:secret@artifacts.example.com/a.json',
      'https://localhost/a.json',
      'https://192.168.1.1/evidence.json',
      'https://artifacts.example.com/a.json#fragment',
      'https://artifacts.example.com:444/a.json',
    ]) {
      const evidence = goodEvidence();
      (evidence.gates as Record<string, Record<string, unknown>>).protocol.artifactUrls = [url];
      expect(validateEvidence(evidence, revision, now), url).toContain(
        'gates.protocol.artifactUrls'
      );
    }
  });

  it('requires an auditable review and valid image provenance reference', () => {
    const evidence = goodEvidence();
    evidence.review.reviewedAt = '2026-10-29T12:00:00.000Z';
    evidence.review.referenceUrl = 'not-a-url';
    evidence.imageProvenanceUrl = 'https://';
    expect(validateEvidence(evidence, revision, now)).toEqual(
      expect.arrayContaining(['review.reviewedAt', 'review.referenceUrl', 'imageProvenanceUrl'])
    );
  });

  it('loads evidence only from a bounded regular file outside the repository, resolving symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-certify-root-'));
    const external = mkdtempSync(join(tmpdir(), 'mcp-certify-evidence-'));
    temporaryDirectories.push(root, external);
    const inside = join(root, 'inside.json');
    const outside = join(external, 'outside.json');
    writeFileSync(inside, JSON.stringify(goodEvidence()));
    writeFileSync(outside, JSON.stringify(goodEvidence()));
    expect(loadEvidenceFile(outside, root)).toMatchObject({ schemaVersion: 1 });
    expect(() => loadEvidenceFile(inside, root)).toThrow('outside the repository');
    const link = join(external, 'inside-link.json');
    symlinkSync(inside, link);
    expect(() => loadEvidenceFile(link, root)).toThrow('outside the repository');
  });

  it('rejects oversized evidence files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-certify-root-'));
    const external = mkdtempSync(join(tmpdir(), 'mcp-certify-evidence-'));
    temporaryDirectories.push(root, external);
    const oversized = join(external, 'oversized.json');
    writeFileSync(oversized, ' '.repeat(1024 * 1024 + 1));
    expect(() => loadEvidenceFile(oversized, root)).toThrow('1 MiB limit');
  });
});
