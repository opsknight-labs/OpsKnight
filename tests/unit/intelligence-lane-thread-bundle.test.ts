import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
});
