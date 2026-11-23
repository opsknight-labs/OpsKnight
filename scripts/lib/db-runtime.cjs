/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader for operator scripts */
'use strict';
/**
 * Loads the OpsKnight database runtime (src/lib/db/runtime-entry.ts) for CommonJS/ESM scripts.
 *
 * Development and CI run the TypeScript source through ts-node so scripts never use a stale
 * build. Production images have no dev dependencies and use the bundle produced by
 * `npm run build:scripts` (scripts/dist/db-runtime.cjs).
 */
const path = require('node:path');

function hasTsNode() {
  if (process.env.OPSKNIGHT_DB_RUNTIME === 'bundle') return false;
  try {
    require.resolve('ts-node');
    return true;
  } catch {
    return false;
  }
}

if (hasTsNode()) {
  require('ts-node').register({
    project: path.join(__dirname, '..', '..', 'tsconfig.script.json'),
    transpileOnly: true,
  });
  module.exports = require('../../src/lib/db/runtime-entry.ts');
} else {
  module.exports = require('../dist/db-runtime.cjs');
}
