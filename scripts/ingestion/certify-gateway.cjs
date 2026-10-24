/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local Docker certification. */
/* eslint-disable security/detect-non-literal-fs-filename -- Files are confined to this run's private temporary directory and explicit evidence destination. */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { renderIngestionGateway } = require('../../deploy/scripts/ingestion-gateway.cjs');
const exec = promisify(execFile);
const docker =
  process.env.INGESTION_DOCKER || '/Applications/Docker.app/Contents/Resources/bin/docker';
const run = randomUUID();
const prefix = `ingestion-edge-${run.slice(0, 8)}`;
const network = `${prefix}-network`;
const directory = mkdtempSync(path.join(tmpdir(), 'ingestion-edge-'));
const containers = [];
const evidence = { certifiedEnterprise: false, runId: run, passed: false, cleanupFailures: [] };
let networkCreated = false;
async function invoke(args) {
  return (await exec(docker, args, { maxBuffer: 100000 })).stdout.trim();
}
async function owned(name) {
  const result = JSON.parse(await invoke(['inspect', name]))[0];
  assert.equal(result.Config.Labels['opsknight.ingestion-cert-run'], run);
  return result;
}
async function main() {
  const appImage = JSON.parse(
    await invoke([
      'image',
      'inspect',
      process.env.INGESTION_IMAGE || 'opsknight-ingestion-cert:8cfe6058f',
    ])
  )[0];
  const proxyImage = JSON.parse(
    await invoke(['image', 'inspect', process.env.INGESTION_PROXY_IMAGE || 'nginx:stable-alpine'])
  )[0];
  evidence.images = { upstream: appImage.Id, proxy: proxyImage.Id };
  await invoke(['network', 'create', '--label', `opsknight.ingestion-cert-run=${run}`, network]);
  networkCreated = true;
  const upstream = `${prefix}-upstream`,
    proxy = `${prefix}-proxy`;
  const source = `const http=require('node:http');let count=0;const pending=[];http.createServer((req,res)=>{if(req.url==='/release'){for(const response of pending.splice(0))response.writeHead(202).end('{}');res.end('released');return;}if(req.method==='GET'){res.end(JSON.stringify({count}));return;}req.resume();req.on('end',()=>{count++;if(req.headers['x-fixture-hold'])pending.push(res);else res.writeHead(202).end('{}');});}).listen(3000,'0.0.0.0');`;
  for (const [name, image, extra] of [
    [upstream, appImage.Id, ['--entrypoint', 'node', appImage.Id, '-e', source]],
    [proxy, proxyImage.Id, []],
  ]) {
    containers.push(name);
    if (name === upstream) {
      await invoke([
        'run',
        '--detach',
        '--name',
        name,
        '--network',
        network,
        '--label',
        `opsknight.ingestion-cert-run=${run}`,
        '--cpus',
        '0.25',
        '--memory',
        '64m',
        ...extra,
      ]);
    } else {
      const config = path.join(directory, 'nginx.conf');
      writeFileSync(
        config,
        renderIngestionGateway({
          upstreams: [`${upstream}:3000`],
          maxInFlight: 2,
          bodyIdleSeconds: 2,
        }).replace(
          'access_log off;',
          "log_format safe_status '$status'; access_log /dev/stdout safe_status;"
        ),
        { mode: 0o600 }
      );
      await invoke([
        'run',
        '--detach',
        '--name',
        name,
        '--network',
        network,
        '--label',
        `opsknight.ingestion-cert-run=${run}`,
        '--cpus',
        '0.25',
        '--memory',
        '32m',
        '--publish',
        '127.0.0.1::8080',
        '--mount',
        `type=bind,source=${config},target=/etc/nginx/nginx.conf,readonly`,
        image,
      ]);
    }
  }
  const info = await owned(proxy);
  const port = info.NetworkSettings.Ports['8080/tcp'][0].HostPort;
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await invoke(['exec', proxy, 'nginx', '-t']);
  const holds = [0, 1].map(() =>
    fetch(`${url}/api/events`, {
      method: 'POST',
      headers: { 'x-fixture-hold': 'yes' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    })
  );
  let active = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    active = (await (await fetch(url)).json()).count;
    if (active === 2) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(active, 2);
  const excess = await fetch(`${url}/api/integrations/webhook`, { method: 'POST', body: '{}' });
  assert.equal(excess.status, 503);
  assert.equal(excess.headers.get('Retry-After'), '5');
  assert.equal((await excess.json()).error, 'INGESTION_OVERLOADED');
  assert.equal((await (await fetch(url)).json()).count, 2, 'Excess request reached upstream');
  assert.equal((await fetch(`${url}/api/admin/ingestion`)).status, 200, 'Operator GET was blocked');
  await fetch(`${url}/release`);
  assert.ok((await Promise.all(holds)).every(response => response.status === 202));
  assert.equal((await fetch(`${url}/api/events`, { method: 'POST', body: '{}' })).status, 202);
  const idleStart = Date.now();
  const idleStatus = await new Promise((resolve, reject) => {
    const client = http.request(`${url}/api/events`, { method: 'POST', agent: false });
    const timer = setTimeout(() => client.destroy(new Error('Idle body did not expire')), 5000);
    client.once('error', error => {
      clearTimeout(timer);
      if (error.code === 'ECONNRESET') resolve('connection-reset');
      else reject(error);
    });
    client.once('response', response => {
      response.resume();
      clearTimeout(timer);
      client.destroy();
      resolve(response.statusCode);
    });
    client.flushHeaders();
    client.write('{');
  });
  assert.ok([408, 'connection-reset'].includes(idleStatus));
  const idleBodyMs = Date.now() - idleStart;
  assert.ok(idleBodyMs >= 1500 && idleBodyMs < 4500);
  assert.equal((await (await fetch(url)).json()).count, 3, 'Partial body reached upstream');
  const sentinel = 'fixture-credential-must-not-log';
  const privateUrl = `${url}/api/integrations/webhook?key=${sentinel}`;
  assert.equal(
    (await fetch(privateUrl, { method: 'POST', body: 'x'.repeat(128 * 1024) })).status,
    202
  );
  assert.equal(
    (await fetch(privateUrl, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })).status,
    413
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  const logs = await exec(docker, ['logs', proxy], { maxBuffer: 100000 });
  assert.ok(
    (logs.stdout + logs.stderr).split('\n').some(line => line.trim() === '408'),
    'Nginx must record the idle-body 408 status even when the client sees a reset'
  );
  assert.equal(
    (logs.stdout + logs.stderr).includes(sentinel),
    false,
    'Query credential sentinel appeared in proxy logs'
  );
  evidence.checks = {
    syntax: true,
    globalPostConcurrency: true,
    crossProvider503: true,
    retryAfter: true,
    excessNotForwarded: true,
    operatorGetAvailable: true,
    recovery202: true,
    idleBodyServerStatus: 408,
    idleBodyClientOutcome: idleStatus,
    idleBodyMs,
    queryCredentialAbsentFromLogs: true,
  };
  evidence.scope =
    'Actual owned Nginx and synthetic HTTP upstream only; no application receipts, distributed limits or enterprise capacity certification. Body timeout is idle time, not total upload duration.';
  evidence.passed = true;
}
main()
  .catch(error => {
    console.error(error);
    evidence.error = error.message;
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const name of containers.reverse()) {
      try {
        await owned(name);
        await invoke(['rm', '--force', name]);
      } catch {
        evidence.cleanupFailures.push(name);
        process.exitCode = 1;
      }
    }
    if (networkCreated) {
      try {
        const n = JSON.parse(await invoke(['network', 'inspect', network]))[0];
        assert.equal(n.Labels['opsknight.ingestion-cert-run'], run);
        await invoke(['network', 'rm', network]);
      } catch {
        evidence.cleanupFailures.push(network);
        process.exitCode = 1;
      }
    }
    rmSync(directory, { recursive: true, force: true });
    evidence.recordedAt = new Date().toISOString();
    writeFileSync(
      process.env.INGESTION_GATEWAY_EVIDENCE ||
        'plans/event-ingestion/local-gateway-backpressure.json',
      JSON.stringify(evidence, null, 2) + '\n'
    );
  });
