/* eslint-disable @typescript-eslint/no-require-imports -- Executable CommonJS harness loads the shared TypeScript fixture runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Paths are validated fixture evidence destinations or files inside this run's private temporary directory. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const prisma = require('../../src/lib/prisma').default;
const { calculateRuntimeCapacity } = require('../../deploy/scripts/validate-runtime-capacity.cjs');
const docker =
  process.env.INGESTION_DOCKER || '/Applications/Docker.app/Contents/Resources/bin/docker';
const runId = randomUUID();
const prefix = `ingestion-cert-${runId.slice(0, 8)}`;
const network = `${prefix}-network`;
const databaseContainer = 'opsknight-ingestion-cert-db';
const containers = [];
const directory = mkdtempSync(path.join(os.tmpdir(), 'ingestion-docker-'));
const evidencePath =
  process.env.INGESTION_DOCKER_EVIDENCE || 'plans/event-ingestion/local-docker-topology.json';
const httpEvidencePath =
  process.env.INGESTION_HTTP_EVIDENCE || 'plans/event-ingestion/local-docker-http.json';
let attached = false;
let createdNetwork = false;
let child;
let chaosTimer;
let notificationTimer;
let notificationTask;
let chaosTask;
let resolveChaos;
let loadActive = false;
let cancelled = false;
const profiles = [];
const cpuProfiling = process.env.INGESTION_CPU_PROFILE === 'true';
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    cancelled = true;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* child already stopped */
      }
    }
  });
const evidence = { runId, certifiedEnterprise: false, cleanupFailures: [], chaos: [] };
function invoke(args) {
  if (
    cancelled &&
    (args[0] === 'run' || (args[0] === 'network' && ['create', 'connect'].includes(args[1])))
  )
    return Promise.reject(new Error('Certification cancelled'));
  return new Promise((resolve, reject) => {
    const process = spawn(docker, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    process.stdout.on('data', data => {
      output = (output + data.toString()).slice(-100000);
    });
    process.stderr.on('data', data => {
      error = (error + data.toString()).slice(-4000);
    });
    process.once('error', reject);
    process.once('exit', code =>
      code === 0 ? resolve(output.trim()) : reject(new Error(`Docker ${args[0]} failed: ${error}`))
    );
  });
}
const inspect = async name => JSON.parse(await invoke(['inspect', name]))[0];
async function assertCredentialSentinelAbsentFromLogs(name) {
  const sentinel = 'fixture-credential-must-not-persist';
  await new Promise((resolve, reject) => {
    const child = spawn(docker, ['logs', name], { stdio: ['ignore', 'pipe', 'pipe'] });
    let found = false;
    for (const stream of [child.stdout, child.stderr]) {
      let suffix = '';
      stream.on('data', chunk => {
        const text = suffix + chunk.toString();
        found ||= text.includes(sentinel);
        suffix = text.slice(-(sentinel.length - 1));
      });
    }
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error('Candidate log privacy check failed to read logs'));
      else if (found) reject(new Error('Credential privacy sentinel appeared in candidate logs'));
      else resolve();
    });
  });
}
async function resources(name) {
  const container = await inspect(name);
  assert.equal(container.Config.Labels['opsknight.ingestion-cert-run'], runId);
  const snapshot = {
    name,
    running: container.State.Running,
    oomKilled: container.State.OOMKilled,
    exitCode: container.State.ExitCode,
    limits: {
      cpuCores: container.HostConfig.NanoCpus / 1e9,
      memoryBytes: container.HostConfig.Memory,
    },
  };
  if (container.State.Running) {
    try {
      snapshot.cgroup = JSON.parse(
        await invoke([
          'exec',
          name,
          'node',
          '-e',
          "const fs=require('node:fs'); const read=p=>fs.readFileSync('/sys/fs/cgroup/'+p,'utf8').trim(); const counters=p=>Object.fromEntries(read(p).split('\\n').map(l=>{const[k,v]=l.split(/\\s+/);return[k,Number(v)]})); process.stdout.write(JSON.stringify({cpu:counters('cpu.stat'),memoryCurrentBytes:Number(read('memory.current')),memoryPeakBytes:Number(read('memory.peak')),memoryEvents:counters('memory.events')}));",
        ])
      );
    } catch {
      snapshot.resourceCountersUnavailable = true;
    }
  }
  return snapshot;
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFile(name, file) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const exists = await invoke([
      'exec',
      name,
      'node',
      '-e',
      'process.stdout.write(String(require("node:fs").existsSync(process.argv[1])))',
      file,
    ]);
    if (exists === 'true') return;
    await sleep(250);
  }
  throw new Error('Owned CPU profiler did not finish its operation');
}
async function startProfile(name) {
  const output = `/tmp/ingestion-cpu-${runId}.cpuprofile`;
  const stop = `/tmp/ingestion-cpu-${runId}.stop`;
  const client = `/tmp/ingestion-cpu-${runId}.cjs`;
  await invoke(['kill', '--signal', 'USR1', name]);
  await invoke(['cp', path.join(__dirname, 'container-cpu-profile.cjs'), `${name}:${client}`]);
  await invoke([
    'exec',
    '--detach',
    name,
    'node',
    '--experimental-websocket',
    client,
    runId,
    output,
    stop,
  ]);
  await waitFile(name, `${output}.ready`);
  profiles.push({ name, output, stop, collected: false });
}
async function collectProfiles() {
  for (const profile of profiles.filter(item => !item.collected)) {
    await invoke([
      'exec',
      profile.name,
      'node',
      '-e',
      'require("node:fs").writeFileSync(process.argv[1],"stop")',
      profile.stop,
    ]);
    await waitFile(profile.name, profile.output);
    const destination =
      process.env.INGESTION_CPU_PROFILE_DIRECTORY ||
      path.join(os.tmpdir(), 'opsknight-ingestion-profiles', runId);
    mkdirSync(destination, { recursive: true });
    const output = path.join(destination, `${profile.name}.cpuprofile`);
    await invoke(['cp', `${profile.name}:${profile.output}`, output]);
    profile.collected = true;
    (evidence.cpuProfiles ||= []).push({
      container: profile.name,
      file: output,
      scope: 'Diagnostic sampling includes preflight/warmup/load; not capacity certification',
    });
  }
}
async function waitHealthy(name) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (cancelled) throw new Error('Certification cancelled');
    const container = await inspect(name);
    if (!container.State.Running) throw new Error(`Candidate ${name} exited before readiness`);
    if (container.State.Health?.Status === 'healthy') return;
    await sleep(1000);
  }
  throw new Error(`Candidate ${name} did not become ready`);
}
async function main() {
  const localUrl = new URL(process.env.DATABASE_URL);
  assert.ok(
    localUrl.pathname === '/ingestion_test_http' ||
      (localUrl.pathname.startsWith('/ingestion_test_http_') &&
        /^[a-z0-9_]+$/.test(localUrl.pathname.slice('/ingestion_test_http_'.length)))
  );
  assert.equal(localUrl.port, '55445');
  if (process.env.INGESTION_DB_PROFILE === 'true') {
    // Fail before starting replicas when a newly created fixture database has
    // not enabled the explicitly requested diagnostic extension.
    await prisma.$queryRaw`SELECT calls FROM pg_stat_statements LIMIT 0`;
  }
  const pg = await inspect(databaseContainer);
  assert.ok(pg.Config.Image.startsWith('postgres:16'));
  assert.ok(
    pg.NetworkSettings.Ports['5432/tcp'].some(
      binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '55445'
    )
  );
  const image = process.env.INGESTION_IMAGE;
  assert.ok(image, 'Set INGESTION_IMAGE to the exact candidate image');
  const imageInfo = JSON.parse(await invoke(['image', 'inspect', image]))[0];
  const revision = imageInfo.Config.Labels['org.opencontainers.image.revision'];
  assert.ok(revision && revision !== 'unknown', 'Candidate must have a source revision label');
  const webReplicas = Number(process.env.INGESTION_WEB_REPLICAS || 2);
  const workerReplicas = Number(process.env.INGESTION_WORKER_REPLICAS || 4);
  const webCpus = Number(process.env.INGESTION_WEB_CPUS || 1);
  const workerCpus = Number(process.env.INGESTION_WORKER_CPUS || 1);
  for (const cpus of [webCpus, workerCpus])
    assert.ok(Number.isFinite(cpus) && cpus >= 0.25 && cpus <= 4);
  assert.ok(Number.isInteger(webReplicas) && webReplicas >= 1 && webReplicas <= 4);
  assert.ok(Number.isInteger(workerReplicas) && workerReplicas >= 1 && workerReplicas <= 8);
  const [limits] =
    await prisma.$queryRaw`SELECT current_setting('max_connections')::int AS maximum`;
  const supportingRoles = [
    { role: 'scheduler', poolName: 'DATABASE_POOL_SIZE_SCHEDULER', pool: 2 },
    { role: 'general-worker', poolName: 'DATABASE_POOL_SIZE_GENERAL_WORKER', pool: 5 },
    { role: 'critical-worker', poolName: 'DATABASE_POOL_SIZE_CRITICAL_WORKER', pool: 5 },
    { role: 'bulk-worker', poolName: 'DATABASE_POOL_SIZE_BULK_WORKER', pool: 3 },
    { role: 'runbook-worker', poolName: 'DATABASE_POOL_SIZE_RUNBOOK_WORKER', pool: 5 },
    { role: 'status-projector', poolName: 'DATABASE_POOL_SIZE_STATUS_PROJECTOR', pool: 2 },
  ];
  const supportingPools = Object.fromEntries(
    supportingRoles.map(item => [item.poolName, String(item.pool)])
  );
  const fullStack = process.env.INGESTION_DOCKER_FULL_STACK === 'true';
  const usePgBouncer = process.env.INGESTION_DOCKER_PGBOUNCER === 'true';
  const pgBouncerCompatibility = process.env.INGESTION_PGBOUNCER_COMPATIBILITY !== 'false';
  const pgBouncerName = `${prefix}-pgbouncer`;
  const capacity = calculateRuntimeCapacity({
    PGBOUNCER_ENABLED: String(usePgBouncer),
    PGBOUNCER_REPLICAS: '1',
    PGBOUNCER_DEFAULT_POOL_SIZE: '15',
    PGBOUNCER_RESERVE_POOL_SIZE: '5',
    ...supportingPools,
    OPSKNIGHT_RUNTIME_MODE: 'split',
    WEB_REPLICAS: String(webReplicas),
    DATABASE_POOL_SIZE_WEB: '10',
    INGESTION_WORKER_REPLICAS: String(workerReplicas),
    DATABASE_POOL_SIZE_INGESTION_WORKER: '5',
    DATABASE_CONNECTION_RESERVE: '15',
    DATABASE_MAX_CONNECTIONS: String(limits.maximum),
  });
  const configuredControl = await require('../../src/lib/ingestion/policy').getIngestionPolicy();
  assert.ok(capacity.safe, 'Local candidate topology exceeds its PostgreSQL connection budget');
  assert.equal(
    await prisma.ingestionReceipt.count({
      where: { status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
    }),
    0,
    'Resolve previous unfinished test work before a fresh topology capacity run'
  );
  const port = Number(process.env.INGESTION_PORT || 3210);
  assert.ok(Number.isInteger(port) && port >= 3200 && port <= 65535);
  const baseUrl = `http://127.0.0.1:${port}`;
  const encryptionKey = randomBytes(32).toString('hex');
  const containerUrl = new URL(localUrl.toString());
  containerUrl.hostname = databaseContainer;
  containerUrl.port = '5432';
  const pooledUrl = new URL(containerUrl.toString());
  pooledUrl.hostname = pgBouncerName;
  pooledUrl.port = '6432';
  if (pgBouncerCompatibility) pooledUrl.searchParams.set('pgbouncer', 'true');
  else pooledUrl.searchParams.delete('pgbouncer');
  const shared = {
    ...supportingPools,
    NODE_ENV: 'production',
    OPSKNIGHT_RUNTIME_MODE: 'split',
    OPSKNIGHT_INGESTION_MODE: 'postgres',
    OPSKNIGHT_INGESTION_CONCURRENCY: '4',
    OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE: '10000000',
    OPSKNIGHT_INGESTION_INTEGRATION_PER_MINUTE: '10000000',
    DATABASE_POOL_SIZE_WEB: '10',
    DATABASE_POOL_SIZE_INGESTION_WORKER: '5',
    NEXTAUTH_SECRET: randomBytes(32).toString('base64url'),
    API_KEY_SECRET: randomBytes(32).toString('base64url'),
    ENCRYPTION_KEY: encryptionKey,
    NEXTAUTH_URL: baseUrl,
    NEXT_PUBLIC_APP_URL: baseUrl,
    REDIRECT_TO_CANONICAL_HOST: 'false',
    TRUST_PROXY_HEADERS: 'false',
    ALLOW_INSECURE_SECRETS: 'true',
    DATABASE_URL: containerUrl.toString(),
    ...(usePgBouncer ? { WEB_DATABASE_URL: pooledUrl.toString(), PGBOUNCER_ENABLED: 'true' } : {}),
  };
  const environmentFile = path.join(directory, 'candidate.env');
  writeFileSync(
    environmentFile,
    Object.entries(shared)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 }
  );
  await invoke(['network', 'create', '--label', `opsknight.ingestion-cert-run=${runId}`, network]);
  createdNetwork = true;
  await invoke(['network', 'connect', network, databaseContainer]);
  attached = true;
  if (usePgBouncer) {
    // Reuse the repository's pinned base and production configuration entrypoint.
    const poolImageRef =
      'ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75';
    try {
      await invoke(['image', 'inspect', poolImageRef]);
    } catch {
      await invoke(['pull', poolImageRef]);
    }
    const poolImage = JSON.parse(await invoke(['image', 'inspect', poolImageRef]))[0];
    const poolEnv = path.join(directory, 'pool.env');
    const poolSettings = {
      FORCE_DYNAMIC_CONFIG: 'true',
      PGBOUNCER_DB_HOST: databaseContainer,
      PGBOUNCER_DB_PORT: '5432',
      PGBOUNCER_DB_NAME: localUrl.pathname.slice(1),
      PGBOUNCER_DB_USER: decodeURIComponent(localUrl.username),
      PGBOUNCER_DB_PASSWORD: decodeURIComponent(localUrl.password),
      PGBOUNCER_SERVER_TLS_SSLMODE: 'disable',
      PGBOUNCER_POOL_MODE: 'transaction',
      PGBOUNCER_DEFAULT_POOL_SIZE: '15',
      PGBOUNCER_RESERVE_POOL_SIZE: '5',
      PGPASSWORD: decodeURIComponent(localUrl.password),
      PGCONNECT_TIMEOUT: '2',
    };
    writeFileSync(
      poolEnv,
      Object.entries(poolSettings)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      { mode: 0o600 }
    );
    containers.push(pgBouncerName);
    await invoke([
      'run',
      '--detach',
      '--name',
      pgBouncerName,
      '--network',
      network,
      '--label',
      `opsknight.ingestion-cert-run=${runId}`,
      '--cpus',
      '1',
      '--memory',
      '128m',
      '--env-file',
      poolEnv,
      '--mount',
      `type=bind,source=${path.resolve('deploy/images/pgbouncer/entrypoint.sh')},target=/docker-entrypoint.sh,readonly`,
      '--entrypoint',
      '/docker-entrypoint.sh',
      poolImage.Id,
    ]);
    let poolReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        poolReady =
          (await invoke([
            'exec',
            '--env-file',
            poolEnv,
            pgBouncerName,
            '/usr/bin/psql',
            '-h',
            '127.0.0.1',
            '-p',
            '6432',
            '-U',
            decodeURIComponent(localUrl.username),
            '-d',
            localUrl.pathname.slice(1),
            '-tAc',
            'SELECT 1',
          ])) === '1';
      } catch {
        /* fixture pool starting */
      }
      if (poolReady) break;
      await sleep(500);
    }
    assert.ok(poolReady, 'Owned PgBouncer did not authenticate to the test database');
    evidence.pgbouncer = {
      imageId: poolImage.Id,
      webOnly: true,
      poolMode: 'transaction',
      prismaCompatibilityMode: pgBouncerCompatibility,
      maxPreparedStatements: 100,
      defaultPool: 15,
      reservePool: 5,
      tls: 'disabled on owned local fixture network only',
      resourcesBefore: await resources(pgBouncerName),
    };
  }
  let exerciseNotification;
  if (process.env.INGESTION_DOCKER_SMTP_CHECK === 'true') {
    assert.ok(fullStack, 'SMTP delivery checks require every supporting worker role');
    const smtpRef = process.env.INGESTION_SMTP_IMAGE || 'axllent/mailpit:latest';
    try {
      await invoke(['image', 'inspect', smtpRef]);
    } catch {
      await invoke(['pull', smtpRef]);
    }
    const smtpImage = JSON.parse(await invoke(['image', 'inspect', smtpRef]))[0];
    const smtpName = `${prefix}-smtp`;
    containers.push(smtpName);
    await invoke([
      'run',
      '--detach',
      '--name',
      smtpName,
      '--network',
      network,
      '--label',
      `opsknight.ingestion-cert-run=${runId}`,
      '--cpus',
      '0.5',
      '--memory',
      '128m',
      '--publish',
      '127.0.0.1::8025',
      '--env',
      'MP_SMTP_AUTH_ACCEPT_ANY=true',
      '--env',
      'MP_SMTP_AUTH_ALLOW_INSECURE=true',
      '--env',
      'MP_SMTP_DISABLE_RDNS=true',
      '--env',
      'MP_MAX_MESSAGES=100',
      smtpImage.Id,
    ]);
    const smtp = await inspect(smtpName);
    const binding = smtp.NetworkSettings.Ports['8025/tcp'][0];
    assert.equal(binding.HostIp, '127.0.0.1');
    const captureUrl = `http://127.0.0.1:${binding.HostPort}`;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        ready = (
          await fetch(`${captureUrl}/api/v1/messages`, { signal: AbortSignal.timeout(1000) })
        ).ok;
      } catch {
        /* capture server starting */
      }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Owned SMTP capture did not become ready');
    process.env.ENCRYPTION_KEY = encryptionKey;
    exerciseNotification = await require('./notification-http-checks.cjs')({
      prisma,
      smtpHost: smtpName,
      captureUrl,
    });
    evidence.smtpCapture = {
      imageId: smtpImage.Id,
      localOnly: true,
      remoteDeliveryCertified: false,
    };
  }
  const start = async (name, role, migrationOwner) => {
    containers.push(name);
    await invoke([
      'run',
      '--detach',
      '--name',
      name,
      '--network',
      network,
      '--label',
      `opsknight.ingestion-cert-run=${runId}`,
      '--cpus',
      String(role === 'web' ? webCpus : workerCpus),
      '--memory',
      role === 'web' ? '1g' : '768m',
      '--health-interval',
      '5s',
      '--health-timeout',
      '5s',
      '--health-start-period',
      '60s',
      '--env-file',
      environmentFile,
      '--env',
      `OPSKNIGHT_PROCESS_ROLE=${role}`,
      '--env',
      `OPSKNIGHT_SKIP_MIGRATIONS=${migrationOwner ? 'false' : 'true'}`,
      imageInfo.Id,
    ]);
    await waitHealthy(name);
  };
  const webNames = [];
  for (let index = 0; index < webReplicas; index++) {
    const name = `${prefix}-web-${index}`;
    await start(name, 'web', index === 0);
    webNames.push(name);
  }
  const workers = [];
  for (let index = 0; index < workerReplicas; index++) {
    const name = `${prefix}-worker-${index}`;
    await start(name, 'ingestion-worker', false);
    const readiness = JSON.parse(
      await invoke([
        'exec',
        name,
        'node',
        '-e',
        "fetch('http://127.0.0.1:3000/api/health?mode=readiness').then(r=>r.json()).then(b=>process.stdout.write(JSON.stringify(b.checks.ingestionWorker)))",
      ])
    );
    assert.equal(
      readiness.status,
      'healthy',
      'Image lacks successful local ingestion consumer evidence'
    );
    workers.push(name);
  }
  const supportingProcesses = [];
  if (fullStack) {
    for (const item of supportingRoles) {
      const name = `${prefix}-${item.role}`;
      await start(name, item.role, false);
      supportingProcesses.push(name);
    }
  }
  const processNames = [...webNames, ...workers, ...supportingProcesses];
  if (usePgBouncer) {
    const addresses = await Promise.all(
      [pgBouncerName, ...webNames, ...workers].map(async name => {
        const container = await inspect(name);
        // eslint-disable-next-line security/detect-object-injection -- Network name is generated from this run's UUID, never request input.
        return [name, container.NetworkSettings.Networks[network].IPAddress];
      })
    );
    const connections = await prisma.$queryRaw`
      SELECT host(client_addr) AS address, count(*)::int AS connections
      FROM pg_stat_activity WHERE datname = current_database()
      GROUP BY client_addr`;
    const count = name =>
      connections.find(item => item.address === addresses.find(([key]) => key === name)[1])
        ?.connections || 0;
    assert.ok(count(pgBouncerName) > 0, 'PgBouncer must own application server connections');
    assert.equal(
      webNames.reduce((total, name) => total + count(name), 0),
      0,
      'Web replicas must not bypass PgBouncer'
    );
    assert.ok(
      workers.every(name => count(name) > 0),
      'Ingestion workers must remain direct'
    );
    evidence.pgbouncer.routing = {
      observedServerConnections: count(pgBouncerName),
      directWebConnections: 0,
      directWorkerConnections: workers.reduce((total, name) => total + count(name), 0),
      verifiedThrough: 'PostgreSQL client addresses matched to owned container IPs',
    };
  }
  const proxyRef = process.env.INGESTION_PROXY_IMAGE || 'nginx:stable-alpine';
  try {
    await invoke(['image', 'inspect', proxyRef]);
  } catch {
    await invoke(['pull', proxyRef]);
  }
  const proxy = JSON.parse(await invoke(['image', 'inspect', proxyRef]))[0];
  const proxyConfig = path.join(directory, 'nginx.conf');
  writeFileSync(
    proxyConfig,
    `events { worker_connections 2048; }
http { access_log off; upstream gateways { ${webNames.map(name => `server ${name}:3000;`).join(' ')} keepalive 64; }
server { listen 8080; client_max_body_size 1m;
location / { proxy_pass http://gateways; proxy_http_version 1.1; proxy_set_header Host $http_host; proxy_set_header Connection ""; proxy_next_upstream off; } } }
`
  );
  const proxyName = `${prefix}-proxy`;
  containers.push(proxyName);
  await invoke([
    'run',
    '--detach',
    '--name',
    proxyName,
    '--network',
    network,
    '--label',
    `opsknight.ingestion-cert-run=${runId}`,
    '--cpus',
    '1',
    '--memory',
    '128m',
    '--publish',
    `127.0.0.1:${port}:8080`,
    '--mount',
    `type=bind,source=${proxyConfig},target=/etc/nginx/nginx.conf,readonly`,
    proxy.Id,
  ]);
  const candidateNodeVersion = await invoke([
    'exec',
    webNames[0],
    'node',
    '-e',
    'process.stdout.write(process.version)',
  ]);
  evidence.image = {
    nodeVersion: candidateNodeVersion,
    id: imageInfo.Id,
    revision,
    proxyImageId: proxy.Id,
  };
  evidence.topology = {
    fullStackProcesses: fullStack,
    webUsesPgBouncer: usePgBouncer,
    supportingRoles: fullStack
      ? supportingRoles.map(({ role, pool }) => ({ role, replicas: 1, pool }))
      : [],
    externalEffectsCertified: false,
    webReplicas,
    workerReplicas,
    workerConcurrency: configuredControl.policy.concurrency,
    leaseMs: configuredControl.policy.leaseMs,
    controlRevision: configuredControl.revision,
    webPool: 10,
    workerPool: 5,
    webCpus,
    workerCpus,
    cpuProfiling,
    capacity,
  };
  const candidate = {
    fullStackProcesses: fullStack,
    kind: 'docker',
    nodeVersion: candidateNodeVersion,
    imageId: imageInfo.Id,
    sourceRevision: revision,
    webReplicas,
    workerReplicas,
    webCpus,
    workerCpus,
    cpuProfiling,
    certificationRunId: runId,
    sourceProvenance:
      'Immutable image ID and producer-supplied OCI revision label; no signed build attestation',
  };
  evidence.resourcesBeforePreflight = await Promise.all(processNames.map(resources));
  if (cpuProfiling) for (const name of [webNames[0], workers[0]]) await startProfile(name);
  child = spawn(process.execPath, ['scripts/ingestion/certify-http.cjs'], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    detached: true,
    env: {
      ...process.env,
      ENCRYPTION_KEY: encryptionKey,
      INGESTION_EXTERNAL_BASE_URL: baseUrl,
      INGESTION_EXTERNAL_CONSUMERS: 'true',
      INGESTION_HTTP_EVIDENCE: httpEvidencePath,
      INGESTION_CANDIDATE_METADATA: JSON.stringify(candidate),
    },
  });
  const chaosRequested = process.env.INGESTION_DOCKER_KILL_WORKER === 'true';
  child.on('message', message => {
    if (message?.type === 'ingestion-load-stopped') loadActive = false;
    if (message?.type !== 'ingestion-load-started') return;
    loadActive = true;
    if (exerciseNotification && !notificationTask) {
      notificationTask = new Promise(resolve => {
        notificationTimer = setTimeout(async () => {
          notificationTimer = undefined;
          try {
            evidence.smtpDelivery = await exerciseNotification({
              baseUrl,
              loadActive: () => loadActive,
            });
            resolve(evidence.smtpDelivery.capturedDuringLoad);
          } catch (error) {
            evidence.smtpDelivery = { passed: false, error: error.message };
            resolve(false);
          }
        }, 2000);
      });
    }
    if (!chaosRequested || chaosTask) return;
    chaosTask = new Promise(resolve => {
      resolveChaos = resolve;
    });
    chaosTimer = setTimeout(async () => {
      chaosTimer = undefined;
      try {
        assert.ok(loadActive, 'Load ended before the requested worker termination');
        assert.ok(
          await prisma.ingestionReceipt.count({ where: { serviceId: message.fixtureServiceId } }),
          'No events were accepted before worker termination'
        );
        const recovered = await require('./kill-leased-worker.cjs')({
          prisma,
          baseUrl,
          workers,
          inspect,
          invoke,
          network,
          loadActive: () => loadActive,
        });
        evidence.chaos.push(recovered);
        resolveChaos(true);
      } catch (error) {
        evidence.chaos.push({ action: 'SIGKILL failed', error: error.message });
        resolveChaos(false);
      }
    }, 5000);
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  evidence.resourcesAfterLoad = await Promise.all(processNames.map(resources));
  if (usePgBouncer) evidence.pgbouncer.resourcesAfter = await resources(pgBouncerName);
  if (process.env.INGESTION_HTTP_PROVIDER_CHECKS === 'true') {
    for (const name of processNames) {
      await assertCredentialSentinelAbsentFromLogs(name);
    }
    evidence.credentialSentinelAbsentFromLogs = true;
  }
  await collectProfiles();
  if (chaosTimer) {
    clearTimeout(chaosTimer);
    chaosTimer = undefined;
    resolveChaos?.(false);
  }
  if (exerciseNotification) {
    assert.ok(
      notificationTask && (await notificationTask),
      'Actual SMTP paging delivery did not complete during active load'
    );
  }
  if (chaosRequested)
    assert.ok(
      chaosTask && (await chaosTask),
      'Requested worker termination did not complete during active load'
    );
  evidence.httpEvidence = httpEvidencePath;
  evidence.httpExit = code;
  if (existsSync(httpEvidencePath)) {
    const httpEvidence = JSON.parse(readFileSync(httpEvidencePath, 'utf8'));
    evidence.httpPassed =
      httpEvidence.candidate?.certificationRunId === runId && httpEvidence.passed;
  }
  assert.equal(code, 0, 'Docker topology failed the configured end-to-end thresholds');
  assert.equal(evidence.httpPassed, true, 'Fresh candidate-specific HTTP evidence is required');
}
main()
  .catch(error => {
    console.error(error);
    evidence.error = error.message;
    process.exitCode = 1;
  })
  .finally(async () => {
    if (chaosTimer) clearTimeout(chaosTimer);
    if (notificationTimer) clearTimeout(notificationTimer);
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          resolve();
        }
        const timer = setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* already stopped */
          }
        }, 5000);
        timer.unref();
        child.once('exit', () => clearTimeout(timer));
      });
    }
    await collectProfiles().catch(error => {
      evidence.profilerError = error.message;
      process.exitCode = 1;
    });
    for (const name of containers.reverse()) {
      try {
        const container = await inspect(name);
        if (container.Config.Labels['opsknight.ingestion-cert-run'] === runId)
          await invoke(['rm', '--force', name]);
      } catch (error) {
        evidence.cleanupFailures.push({ target: name, error: error.message });
      }
    }
    if (attached)
      await invoke(['network', 'disconnect', network, databaseContainer]).catch(error =>
        evidence.cleanupFailures.push({ target: databaseContainer, error: error.message })
      );
    if (createdNetwork)
      await invoke(['network', 'rm', network]).catch(error =>
        evidence.cleanupFailures.push({ target: network, error: error.message })
      );
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
    evidence.measuredAt = new Date().toISOString();
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    if (evidence.cleanupFailures.length) process.exitCode = 1;
  });
