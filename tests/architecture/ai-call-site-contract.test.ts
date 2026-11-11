// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Token-efficiency contract for every model call in the product:
 * - a request context that names a capability also names its call site (interactive | proactive | background);
 * - answer length comes from the one table in ai/output-limits.ts, never a caller literal;
 * - UI components and list/badge loaders never import the gateway or the result cache.
 */

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned path under this checkout
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(path);
  }
  return files;
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned path under this checkout
const read = (path: string) => readFileSync(path, 'utf8');
const src = sourceFiles(join(root, 'src'));
const rel = (file: string) => relative(root, file);

/** Object literals written as `context: { ... }`, by brace matching. */
function contexts(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bcontext:\s*\{/g)) {
    let depth = 0;
    for (let index = match.index + match[0].length - 1; index < text.length; index += 1) {
      const char = text.charAt(index);
      if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        found.push(text.slice(match.index, index + 1));
        break;
      }
    }
  }
  return found;
}

describe('AI call-site contract', () => {
  it('tags every model request that names a capability', () => {
    const untagged: string[] = [];
    let tagged = 0;
    for (const file of src) {
      for (const literal of contexts(read(file))) {
        if (!/\bcapability\b/.test(literal) || !/\b(?:actorId|dataClass)\b|\.\.\./.test(literal))
          continue;
        // A spread passes on a context typed without `capability`; the type system requires its tag.
        if (/\bcallSite\b/.test(literal) || /\.\.\.[\w.]*context\b/i.test(literal)) tagged += 1;
        else untagged.push(rel(file));
      }
    }
    expect(untagged).toEqual([]);
    // The scan must keep seeing the known call sites, or it is no longer checking anything.
    expect(tagged).toBeGreaterThanOrEqual(7);
  });

  it('uses only the three known call-site tags', () => {
    const offenders = src.filter(file =>
      [...read(file).matchAll(/\bcallSite:\s*'([^']*)'/g)].some(
        match => !['interactive', 'proactive', 'background'].includes(match[1])
      )
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('keeps the gateway check in front of admission for every entry point', () => {
    const gateway = read(join(root, 'src/lib/intelligence/ai/gateway.ts'));
    expect(gateway).toMatch(
      /private async admit\(request: AiGenerateRequest\) \{\s*assertCallSite\(request\);/
    );
    for (const signature of [
      'async generateStructured<T>(',
      'async generate(request',
      'async *stream(request',
    ]) {
      const start = gateway.indexOf(signature);
      expect(start, signature).toBeGreaterThan(0);
      expect(gateway.slice(start, start + 400)).toContain('await this.admit(request)');
    }
  });

  it('takes answer length from the output table, never a literal at the call site', () => {
    const offenders = src.filter(
      file =>
        !rel(file).startsWith('src/lib/intelligence/ai/') &&
        /\bmaxOutputTokens:\s*(?:\d|[\w.]+\s*===)/.test(read(file))
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('keeps model access out of components and list/badge loaders', () => {
    const modelAccess =
      /from '(?:@\/lib\/intelligence|\.\.?(?:\/\.\.)*)\/ai\/(?:gateway|result-cache)'|\bresolveLanguageModel\b/;
    const guarded = src.filter(file => {
      const path = rel(file);
      return (
        path.startsWith('src/components/') ||
        path.startsWith('src/lib/intelligence/incident-ux/') ||
        path.startsWith('src/lib/intelligence/overview/')
      );
    });
    expect(guarded.length).toBeGreaterThan(50);
    expect(guarded.filter(file => modelAccess.test(read(file))).map(rel)).toEqual([]);
  });

  it('runs list and badge loaders inside the deterministic zone', () => {
    for (const file of [
      'src/lib/intelligence/incident-ux/list-badges.ts',
      'src/lib/intelligence/incident-ux/wallboard-noise.ts',
      'src/lib/intelligence/overview/scope.ts',
    ])
      expect(read(join(root, file))).toMatch(/deterministicOnly\(/);
  });
});
