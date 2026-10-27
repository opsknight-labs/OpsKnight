'use strict';
// Owned, disposable local infrastructure only; this is not GA certification.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

if (process.argv.includes('--help')) {
  process.stdout.write(
    'Node 20+, Docker and installed locked dependencies required.\nCreates disposable PostgreSQL, builds and tests MCP in Chromium, Firefox and WebKit.\nLogs remain outside git; owned server and database are removed on exit.\n'
  );
  process.exit(0);
}
if (process.argv.length > 2) throw new Error('Unexpected argument; use --help');
if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node 20+ required');
const root = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'opsknight-mcp-local-'));
fs.chmodSync(output, 0o700);
const container = `opsknight-mcp-local-${randomBytes(6).toString('hex')}`;
const report = {
  certified: false,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
  ),
  startedAt: new Date().toISOString(),
  stages: [],
};
let databaseOwned = false;
let server;
let active;
let interrupted = false;
const env = { ...process.env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of [
  'NEXTAUTH_SECRET',
  'ENCRYPTION_KEY',
  'API_KEY_SECRET',
  'MCP_TOKEN_HASH_SECRET',
]) {
  env[key] = randomBytes(32).toString('hex');
}
function run(name, command, args, stageEnv = env) {
  process.stdout.write(`MCP local check: ${name}\n`);
  const started = Date.now();
  const fd = fs.openSync(path.join(output, `${name}.log`), 'w', 0o600);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: stageEnv, stdio: ['ignore', fd, fd] });
    active = child;
    fs.closeSync(fd);
    child.once('error', () => reject(new Error(`Unable to start ${name}`)));
    child.once('close', code => {
      active = undefined;
      report.stages.push({ name, passed: code === 0, durationMs: Date.now() - started });
      if (code === 0 && !interrupted) resolve();
      else reject(new Error(`Stage ${name} failed; inspect ${output}`));
    });
  });
}
const node = (name, file, args = [], stageEnv = env) =>
  run(name, process.execPath, [file, ...args], stageEnv);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let attempt = 0; attempt < 120 && !interrupted; attempt++) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error('Local service readiness deadline exceeded');
}
function stop() {
  interrupted = true;
  active?.kill('SIGTERM');
  server?.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
async function main() {
  process.stdout.write(`Local evidence: ${output}\n`);
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://localhost:${port}`;
  Object.assign(env, {
    NEXTAUTH_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
    MCP_PUBLIC_ORIGIN: origin,
    MCP_E2E_BASE_URL: origin,
    MCP_E2E_OUTPUT: path.join(output, 'browser'),
    MCP_QUERY_PROFILE_OUTPUT: path.join(output, 'query-profile.json'),
    OPSKNIGHT_PROCESS_ROLE: 'web',
    HOSTNAME: 'localhost',
    PORT: String(port),
    TRUST_PROXY_HEADERS: 'false',
    NEXTAUTH_COOKIE_SECURE: 'false',
  });
  const password = randomBytes(24).toString('hex');
  // Pass the disposable password via environment, never a process argument.
  // Claim only this unpredictable generated name before starting Docker, so an
  // interrupted run still attempts cleanup if container creation succeeded.
  databaseOwned = true;
  await run(
    'postgres-start',
    'docker',
    [
      'run',
      '-d',
      '--name',
      container,
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=opsknight_mcp_test',
      '-p',
      '127.0.0.1::5432',
      'postgres:16-alpine',
    ],
    { ...env, POSTGRES_PASSWORD: password }
  );
  const mapping = JSON.parse(
    execFileSync('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], {
      encoding: 'utf8',
    })
  );
  const pgPort = mapping['5432/tcp'][0].HostPort;
  await waitFor(async () => {
    try {
      execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  });
  env.DATABASE_URL = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/opsknight_mcp_test`;
  env.WEB_DATABASE_URL = env.DATABASE_URL;
  env.MCP_DATABASE_URL = env.DATABASE_URL;
  env.MCP_DATABASE_POOL_SIZE = '2';
  await node('prisma-generate', 'node_modules/prisma/build/index.js', ['generate']);
  await node('migrate', 'node_modules/prisma/build/index.js', ['migrate', 'deploy']);
  await node('typecheck', 'node_modules/typescript/bin/tsc', ['--noEmit']);
  await node('mcp-unit', 'node_modules/vitest/vitest.mjs', [
    'run',
    '--no-file-parallelism',
    '--maxWorkers=1',
    'tests/mcp',
  ]);
  await node('database-config', 'node_modules/vitest/vitest.mjs', [
    'run',
    '--no-file-parallelism',
    '--maxWorkers=1',
    'tests/lib/prisma-datasource.test.ts',
    'tests/lib/deployment-config-unit.test.ts',
  ]);
  await node('mcp-database', 'node_modules/vitest/vitest.mjs', [
    'run',
    '-c',
    'vitest.int.config.ts',
    '--no-file-parallelism',
    '--maxWorkers=1',
    'tests/integration/mcp-security-database.test.ts',
    'tests/integration/mcp-database-isolation.test.ts',
    'tests/integration/mcp-query-profile.test.ts',
    'tests/integration/mcp-runbook-approval.test.ts',
  ]);
  await node(
    'coverage',
    'node_modules/ts-node/dist/bin.js',
    ['-r', 'tsconfig-paths/register', 'scripts/mcp/coverage-matrix.ts'],
    { ...env, TS_NODE_PROJECT: 'tsconfig.script.json' }
  );
  await node('build', 'node_modules/next/dist/bin/next', ['build', '--webpack'], {
    ...env, NODE_OPTIONS: env.NODE_OPTIONS || '--max-old-space-size=6144',
  });
  await run('browser-database', 'docker', [
    'exec',
    container,
    'createdb',
    '-U',
    'postgres',
    'opsknight_mcp_browser_test',
  ]);
  env.DATABASE_URL = env.DATABASE_URL.replace('/opsknight_mcp_test', '/opsknight_mcp_browser_test');
  env.WEB_DATABASE_URL = env.DATABASE_URL;
  env.MCP_DATABASE_URL = env.DATABASE_URL;
  await node('browser-migrate', 'node_modules/prisma/build/index.js', ['migrate', 'deploy']);
  await node('browser-seed', 'scripts/mcp/seed-local.cjs');
  await node('browser-auth', 'scripts/prepare-authentication-diagnostics.cjs');
  await node('browser-install', 'node_modules/@playwright/test/cli.js', [
    'install',
    'chromium',
    'firefox',
    'webkit',
  ]);
  fs.cpSync(path.join(root, 'public'), path.join(root, '.next/standalone/public'), {
    recursive: true,
  });
  fs.cpSync(path.join(root, '.next/static'), path.join(root, '.next/standalone/.next/static'), {
    recursive: true,
  });
  const fd = fs.openSync(path.join(output, 'server.log'), 'w', 0o600);
  server = spawn(process.execPath, ['.next/standalone/server.js'], {
    cwd: root,
    env: { ...env, NODE_ENV: 'production', LOG_LEVEL: 'error' },
    stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  let startupError;
  server.once('error', error => {
    startupError = error;
  });
  await waitFor(async () => {
    if (startupError || server.exitCode !== null)
      throw new Error('Local production server failed to start');
    try {
      return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      return false;
    }
  });
  await node('browser', 'node_modules/@playwright/test/cli.js', [
    'test',
    '-c',
    'playwright.mcp.config.ts',
  ]);
}
main()
  .catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    if (databaseOwned) {
      try {
        execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
      } catch {
        process.stderr.write(`Remove owned disposable container ${container} manually.\n`);
      }
    }
    report.finishedAt = new Date().toISOString();
    report.passed = !process.exitCode && !interrupted;
    if (interrupted) process.exitCode = 1;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    process.stdout.write(
      `Local checks ${report.passed ? 'passed' : 'failed'}; release certification remains false. Evidence: ${output}\n`
    );
  });
