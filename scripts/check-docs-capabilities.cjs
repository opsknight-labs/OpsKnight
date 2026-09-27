#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'docs', 'build-doc-map.mjs');
const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
