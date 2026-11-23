#!/usr/bin/env node
// Bundle the TypeScript helpers that production images run without dev dependencies.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bundles = [
  // Database runtime for CommonJS/ESM operator scripts (scripts/lib/db-runtime.cjs).
  ['src/lib/db/runtime-entry.ts', 'scripts/dist/db-runtime.cjs'],
  // Migration recovery run by docker-entrypoint.sh when `migrate deploy` fails.
  ['scripts/auto-recover-migrations.ts', 'scripts/dist/scripts/auto-recover-migrations.js'],
];

for (const [entry, outfile] of bundles) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(root, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Resolved from node_modules at run time so the image shares one Prisma/pg installation
    // (and one Prisma.Sql class) with the application server.
    external: ['@prisma/client', '@prisma/adapter-pg', '@prisma/driver-adapter-utils', 'pg'],
    legalComments: 'none',
    logLevel: 'warning',
  });
  console.log(`Built ${outfile}`);
}
