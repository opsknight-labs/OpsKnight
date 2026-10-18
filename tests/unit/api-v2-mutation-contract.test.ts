/* eslint-disable security/detect-non-literal-fs-filename -- reads repository files at constant paths */
/* eslint-disable security/detect-non-literal-regexp -- pattern is built from fixed internal strings, never user input */
/* eslint-disable security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V2_MUTATION_CONTRACT } from '@/lib/api-v2/mutation-contract';

const ROOT = join(process.cwd(), 'src/app/api/v2');
const MUTATING = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

function discover(): Array<{ key: string; source: string }> {
  const found: Array<{ key: string; source: string }> = [];
  for (const file of routeFiles(ROOT)) {
    const source = readFileSync(file, 'utf8');
    const path = '/api/v2/' + relative(ROOT, file).split(sep).slice(0, -1).join('/');
    for (const method of MUTATING) {
      const declared =
        new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source) ||
        new RegExp(`export\\s+const\\s+${method}\\b`).test(source);
      if (declared) found.push({ key: `${method} ${path}`, source });
    }
  }
  return found;
}

const operations = discover();

describe('REST v2 mutation contract', () => {
  it('discovers the mutating operations', () => {
    expect(operations.length).toBeGreaterThan(20);
  });

  it('classifies every mutating operation, and only existing ones', () => {
    const actual = operations.map(o => o.key).sort();
    const declared = Object.keys(V2_MUTATION_CONTRACT).sort();
    expect(actual.filter(k => !declared.includes(k))).toEqual([]);
    expect(declared.filter(k => !actual.includes(k))).toEqual([]);
  });

  it('backs every idempotency claim with an implementation', () => {
    for (const { key, source } of operations) {
      const contract = V2_MUTATION_CONTRACT[key];
      const honoursKey =
        /runV2IdempotentMutation|runV2IdempotentAuditedMutation|executeIdempotent|transitionIncidentToStatusIdempotent|idempotency:\s|idempotent:\s*true|idempotency-key/i.test(
          source
        );
      if (contract.idempotency === 'required' || contract.idempotency === 'supported') {
        expect(honoursKey, `${key} declares idempotency but the route does not honour a key`).toBe(
          true
        );
      }
    }
  });

  it('never replays a response that carries a one-time secret', () => {
    const tokenIssue = operations.find(o => o.key === 'POST /api/v2/service-accounts/[id]/tokens');
    expect(tokenIssue).toBeDefined();
    expect(V2_MUTATION_CONTRACT[tokenIssue!.key].idempotency).toBe('never');
    expect(/runV2Idempotent|executeIdempotent|idempotent:\s*true/.test(tokenIssue!.source)).toBe(
      false
    );
  });

  it('backs every ETag claim with If-Match handling', () => {
    for (const { key, source } of operations) {
      if (V2_MUTATION_CONTRACT[key].concurrency === 'etag') {
        expect(source, `${key} declares etag concurrency`).toMatch(
          /parseIfMatch|requireDraft|requireRevisionIfMatch|requireRunbookRevision/
        );
        if (V2_MUTATION_CONTRACT[key].responseEtag !== false)
          expect(source, `${key} must emit ETag on its response`).toMatch(
            /etagHeaders|authoringVersionResult|runbookMetadataResult/
          );
      }
    }
  });
});
