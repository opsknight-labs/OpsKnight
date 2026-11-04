#!/usr/bin/env node
// Bundle the database runtime used by CommonJS operator scripts in production images.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'src/lib/db/runtime-entry.ts')],
  outfile: path.join(root, 'scripts/dist/db-runtime.cjs'),
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
console.log('Built scripts/dist/db-runtime.cjs');
