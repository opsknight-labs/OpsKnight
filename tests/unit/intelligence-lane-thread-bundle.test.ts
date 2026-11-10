import { builtinModules } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The runtime image installs production dependencies only (`npm ci --omit=dev`) and ships
 * scripts/dist/intelligence-lane-thread.cjs beside them. Anything the bundle loads at runtime must
 * therefore be a production dependency or a Node.js built-in; everything else must be inside the file.
 */
describe('intelligence lane thread bundle', () => {
  it('requires nothing at runtime that the production image does not install', async () => {
    const script = (await import(
      pathToFileURL(resolve(process.cwd(), 'scripts/build-intelligence-lane-thread.mjs')).href
    )) as {
      buildIntelligenceLaneThread(options: { outfile: string }): Promise<string>;
      productionPackages(): string[];
    };
    const out = await script.buildIntelligenceLaneThread({
      outfile: 'scripts/dist/intelligence-lane-thread-bundle-test.cjs',
    });
    const source = readFileSync(out, 'utf8');
    const loaded = new Set(
      [...source.matchAll(/\b(?:require|import)\("([^"]+)"\)/g)].map(match => match[1])
    );
    const production = new Set(script.productionPackages());
    const outside = [...loaded].filter(specifier => {
      if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return false;
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      return !production.has(name);
    });
    expect(outside).toEqual([]);
    expect(loaded.has('@prisma/client')).toBe(true);
    // `server-only` throws outside a React server bundle; the thread gets the shim instead.
    expect(loaded.has('server-only')).toBe(false);
  }, 60_000);

  it('skips an existing bundle with --if-missing and never fails a start with --optional', () => {
    const script = resolve(process.cwd(), 'scripts/build-intelligence-lane-thread.mjs');
    const directory = mkdtempSync(join(tmpdir(), 'lane-bundle-'));
    try {
      // An existing outfile is left untouched (a start must not rebuild, let alone fail).
      const existing = join(directory, 'existing.cjs');
      writeFileSync(existing, '// kept');
      execFileSync(process.execPath, [script, '--outfile', existing, '--if-missing', '--optional']);
      expect(readFileSync(existing, 'utf8')).toBe('// kept');
      // A bundle that cannot be built is a warning with --optional and an error without it.
      const missing = join(directory, 'missing.cjs');
      const optional = spawnSync(
        process.execPath,
        [
          script,
          '--entry',
          'does/not/exist.ts',
          '--outfile',
          missing,
          '--if-missing',
          '--optional',
        ],
        { encoding: 'utf8' }
      );
      expect(optional.status).toBe(0);
      expect(optional.stderr).toContain('outside the ingestion latency');
      const required = spawnSync(
        process.execPath,
        [script, '--entry', 'does/not/exist.ts', '--outfile', missing],
        { encoding: 'utf8' }
      );
      expect(required.status).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
