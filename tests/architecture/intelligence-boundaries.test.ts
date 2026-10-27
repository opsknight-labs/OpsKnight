// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// semver ships with npm and the toolchain; it is only used to compare engine ranges, so load it
// untyped instead of adding a type package to the dependency set.
const { intersects } = createRequire(import.meta.url)('semver') as {
  intersects: (a: string, b: string) => boolean;
};

const root = process.cwd();
const intelligenceDir = join(root, 'src/lib/intelligence');

function sourceFiles(directory: string): string[] {
  // Test-owned paths are rooted under this checkout.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  // Test-owned paths are rooted under this checkout.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

// eslint-disable-next-line security/detect-non-literal-fs-filename
const read = (path: string) => readFileSync(path, 'utf8');

describe('intelligence architecture boundaries', () => {
  it('reads no process environment: every setting is database-backed and edited from the UI', () => {
    const offenders = sourceFiles(intelligenceDir).filter(file => /process\.env/.test(read(file)));
    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });

  it('keeps the ingestion and incident-creation transactions free of intelligence imports', () => {
    // Stage 0-2 must not change the paging-critical path. A later, separately certified stage may
    // add a single bounded hook from the dedicated ingest-hooks module only.
    for (const file of ['src/lib/events.ts', 'src/lib/incidents/creation.ts']) {
      const imports = read(join(root, file)).match(/from\s+['"]@\/lib\/intelligence[^'"]*['"]/g) ?? [];
      const disallowed = imports.filter(statement => !statement.includes('/intelligence/ingest-hooks'));
      expect(disallowed, `${file} must not import intelligence internals`).toEqual([]);
    }
  });

  it('keeps similarity, correlation and AI work out of the event outbox and job queue core', () => {
    for (const file of ['src/lib/event-outbox.ts', 'src/lib/jobs/queue.ts']) {
      expect(read(join(root, file))).not.toMatch(/@\/lib\/intelligence/);
    }
  });

  it('confines AI SDK imports to the dedicated AI gateway module', () => {
    const aiDir = join(intelligenceDir, 'ai');
    const offenders = sourceFiles(intelligenceDir)
      .filter(file => !file.startsWith(aiDir))
      .filter(file => /from\s+['"](?:ai|@ai-sdk\/[^'"]+|@openrouter\/[^'"]+)['"]/.test(read(file)));
    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });

  it('keeps the shared contract dependency-free so client components can import it', () => {
    const contract = read(join(intelligenceDir, 'contract/index.ts'));
    expect(contract).not.toMatch(
      /(?:from|import)\s+['"](?:@prisma\/client|server-only|@\/lib\/prisma)['"]/
    );
  });

  it('never rewrites incident or alert history from intelligence code', () => {
    const offenders = sourceFiles(intelligenceDir).filter(file =>
      /\b(?:tx|prisma|client)\.(?:incident|alert|incidentEvent|incidentNote)\.(?:update|updateMany|delete|deleteMany|upsert|create|createMany)\b/.test(
        read(file)
      )
    );
    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });
});

describe('runtime compatibility', () => {
  it('only depends on packages that run on the repository Node range', () => {
    // AI SDK 7 requires Node >=22 while the product is pinned to Node 20; this guard keeps any
    // incompatible dependency out until the runtime upgrade is separately certified.
    const pkg = JSON.parse(read(join(root, 'package.json'))) as {
      engines: { node: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const incompatible: string[] = [];
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    })) {
      const manifestPath = join(root, 'node_modules', name, 'package.json');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(read(manifestPath)) as { version: string; engines?: { node?: string } };
      const range = manifest.engines?.node;
      if (range && !intersects(range, pkg.engines.node)) {
        incompatible.push(`${name}@${manifest.version} requires node ${range}`);
      }
    }
    expect(incompatible).toEqual([]);
  });
});

describe('intelligence data model contracts', () => {
  const schema = read(join(root, 'prisma/schema.prisma'));
  const intelligenceModels = [
    'IncidentFingerprint',
    'CorrelationMember',
    'IncidentRelationship',
    'IntelligenceFinding',
  ];

  function modelBody(name: string): string {
    // Model names come from the fixed list in this test, never from input.
    // eslint-disable-next-line security/detect-non-literal-regexp
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    expect(match, `model ${name} must exist`).not.toBeNull();
    return match?.[0] ?? '';
  }

  it('cascades every incident-linked table so retention cleanup can never be blocked', () => {
    for (const name of intelligenceModels) {
      const relations = modelBody(name)
        .split('\n')
        .filter(line => /\bIncident\b.*@relation/.test(line));
      expect(relations.length, `${name} references Incident`).toBeGreaterThan(0);
      for (const line of relations) expect(line).toMatch(/onDelete:\s*Cascade/);
    }
  });

  it('only nulls (never cascades) the correlation group anchor', () => {
    expect(modelBody('CorrelationGroup')).toMatch(
      /anchorIncident\s+Incident\?\s+@relation\([^)]*onDelete:\s*SetNull/
    );
  });

  it('defines the scope-aware correlation identity including policy version and window', () => {
    expect(modelBody('CorrelationGroup')).toMatch(
      /@@unique\(\[policyId, policyVersion, ruleId, scopeHash, signatureHash, windowStart\]/
    );
  });

  it('adds no table partitioning until measurements justify it', () => {
    const migration = read(
      join(root, 'prisma/migrations/20261027120000_intelligence_foundation/migration.sql')
    );
    expect(migration).not.toMatch(/PARTITION\s+BY/i);
  });

  it('makes policy versions and decision events append-only in the database', () => {
    const migration = read(
      join(root, 'prisma/migrations/20261027120000_intelligence_foundation/migration.sql')
    );
    for (const table of [
      'IntelligencePolicyVersion',
      'CorrelationDecisionEvent',
      'IncidentRelationshipEvent',
    ]) {
      // Table names come from the fixed list in this test, never from input.
      const trigger = new RegExp(`CREATE TRIGGER \\w+ BEFORE UPDATE ON "${table}"`); // eslint-disable-line security/detect-non-literal-regexp
      expect(migration).toMatch(trigger);
    }
  });

  it('never lets an unavailable extension fail a deployment', () => {
    const migration = read(
      join(root, 'prisma/migrations/20261027120000_intelligence_foundation/migration.sql')
    );
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm;\s*EXCEPTION WHEN OTHERS/);
    expect(migration).not.toMatch(/CREATE EXTENSION[^;]*\bvector\b/i);
  });

  it('registers every intelligence table in the privacy registry and processing inventory', () => {
    const schema = read(join(root, 'prisma/schema.prisma'));
    const tables = [
      ...schema.matchAll(
        /^model ((?:Intelligence|Correlation|IncidentFingerprint|IncidentRelationship)\w*) \{/gm
      ),
    ].map(match => match[1]);
    expect(tables.length).toBeGreaterThan(10);

    const registry = read(join(root, 'src/lib/privacy/registry.ts'));
    const inventory = read(join(root, 'docs/compliance/data-processing-inventory.yaml'));
    expect(inventory).toContain('domain: intelligence');
    // Settings and the keyset cursor hold no personal data and are intentionally not listed.
    const exempt = new Set(['IntelligenceSettings', 'IntelligencePolicy', 'IntelligenceCursor']);
    const unregistered = tables.filter(
      table => !exempt.has(table) && !registry.includes(`'${table}'`)
    );
    expect(unregistered).toEqual([]);
  });
});
