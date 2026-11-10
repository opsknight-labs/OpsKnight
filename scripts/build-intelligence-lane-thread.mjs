#!/usr/bin/env node
/**
 * Bundles the worker-thread entry of the intelligence lane (src/lib/intelligence/jobs/lane-thread-entry.ts)
 * into scripts/dist/intelligence-lane-thread.cjs. An `integrated` process runs its lane in that thread
 * when the file exists (see src/lib/intelligence/jobs/lane-thread.ts); without it the lane stays on the
 * main thread. Packages stay external (the runtime image ships node_modules, including the generated
 * Prisma client); application code under src/ is bundled. Part of `npm run build:scripts`.
 *
 * Usage: node scripts/build-intelligence-lane-thread.mjs [--entry <file.ts>] [--outfile <file.cjs>]
 */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_ENTRY = 'src/lib/intelligence/jobs/lane-thread-entry.ts';
export const DEFAULT_OUTFILE = 'scripts/dist/intelligence-lane-thread.cjs';

export async function buildIntelligenceLaneThread({
  entry = DEFAULT_ENTRY,
  outfile = DEFAULT_OUTFILE,
} = {}) {
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    packages: 'external',
    tsconfig: resolve(root, 'tsconfig.json'),
    // `server-only` guards Next.js client bundles; a server worker thread is not one.
    alias: { 'server-only': resolve(root, 'scripts/perf/shims/server-only.js') },
    sourcemap: 'linked',
    logLevel: 'warning',
    legalComments: 'none',
  });
  return resolve(root, outfile);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = await buildIntelligenceLaneThread({
    entry: option('--entry'),
    outfile: option('--outfile'),
  });
  console.log(`Built ${out}`);
}
