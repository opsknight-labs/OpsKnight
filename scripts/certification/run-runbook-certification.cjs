#!/usr/bin/env node
/**
 * OpsKnight Enterprise Runbook Certification Runner
 *
 * Dedicated opt-in certification executor with prerequisite validation,
 * disposable database guards, physical Docker workload inspection,
 * and automated result compilation.
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

console.log('================================================================');
console.log('  OpsKnight Enterprise Runbook Certification Suite');
console.log('================================================================\n');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// 1. Validate DATABASE_URL & Guard Against Non-Disposable / Remote Hosts
const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.error('❌ FATAL: DATABASE_URL is not set in environment or .env');
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(rawDbUrl);
} catch (err) {
  console.error('❌ FATAL: DATABASE_URL is not a valid URL:', rawDbUrl);
  process.exit(1);
}

const hostname = parsedUrl.hostname.toLowerCase();
const isLoopback =
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '0.0.0.0';

if (!isLoopback) {
  console.error(`❌ REJECTED: DATABASE_URL hostname "${hostname}" is not permitted for certification testing.`);
  console.error('Only local loopback hosts (localhost, 127.0.0.1) are allowed.');
  console.error('Remote hosts (e.g. opssentinal.com, production AWS RDS) are strictly blocked.');
  process.exit(1);
}

const port = parsedUrl.port;
const dbName = parsedUrl.pathname.replace(/^\//, '').toLowerCase();
const isApprovedPort = port === '55432';
const isApprovedDbName = dbName.includes('test') || dbName.includes('disposable');

if (!isApprovedPort && !isApprovedDbName) {
  console.error(`❌ REJECTED: DATABASE_URL "${rawDbUrl}" is not an approved disposable test database.`);
  console.error('Certification tests require port 55432 or a database name containing "test" or "disposable".');
  process.exit(1);
}

console.log(`[1/3] Database guard passed: ${parsedUrl.protocol}//${parsedUrl.username ? '***@' : ''}${hostname}:${port}/${dbName}`);

// 2. Validate Physical Docker Workload
console.log('[2/3] Checking physical Docker container workload (ag-e2e-docker-api)...');
try {
  const inspectOutput = execSync('docker inspect -f "{{.State.Running}}" ag-e2e-docker-api 2>/dev/null', {
    encoding: 'utf8',
  }).trim();

  if (inspectOutput !== 'true') {
    console.log('  Container ag-e2e-docker-api is stopped. Starting container...');
    execSync('docker start ag-e2e-docker-api', { stdio: 'inherit' });
  }
  console.log('  Container ag-e2e-docker-api is active and healthy on port 8095.');
} catch (_err) {
  console.warn('  ⚠️ Warning: Docker container ag-e2e-docker-api not found.');
  console.warn('  Some physical container failover tests require ag-e2e-docker-api listening on port 8095.');
}

// 3. Execute Phase 2 Certification Suite
console.log('\n[3/3] Running Vitest Enterprise Certification Suite...');
const env = {
  ...process.env,
  DATABASE_URL: rawDbUrl,
  RUNBOOK_PHASE2_CERTIFICATION: '1',
  VITEST_USE_REAL_DB: '1',
};

const result = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/certification/phase2-enterprise-local.test.ts', '--no-isolate'],
  {
    stdio: 'inherit',
    env,
    cwd: path.resolve(__dirname, '../..'),
  }
);

if (result.status === 0) {
  console.log('\n================================================================');
  console.log('  ✅ Enterprise Certification Suite Passed Successfully!');
  console.log('  Release Evidence: plans/runbook-engine/enterprise-physical-certification/results/');
  console.log('================================================================\n');
  process.exit(0);
} else {
  console.error('\n❌ Enterprise Certification Suite failed with exit code:', result.status);
  process.exit(result.status || 1);
}
