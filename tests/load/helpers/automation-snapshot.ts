import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const namespace = 'automation-cert';
const database = 'automation_cert';
const snapshot = 'automation_cert_snapshot';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Destructive restoration is restricted to the explicitly owned Kind fixture. */
export async function requireControlledSnapshotScope() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.OPSKNIGHT_LOAD_CERT_DB !== 'true' ||
    process.env.AUTOMATION_K8S_NAMESPACE !== namespace ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55443' ||
    url.pathname !== `/${database}`
  )
    throw new Error('Controlled restoration requires the owned automation-cert Kind database');
  const { stdout } = await exec('kubectl', ['config', 'current-context']);
  if (stdout.trim() !== 'kind-opsknight-automation')
    throw new Error('Controlled restoration requires the kind-opsknight-automation context');
}

async function kubectl(args: string[]) {
  return exec('kubectl', ['--context', 'kind-opsknight-automation', '-n', namespace, ...args], {
    timeout: 180000,
    maxBuffer: 1024 * 1024,
  });
}
async function sql(statement: string) {
  return kubectl([
    'exec',
    'automation-postgresql-0',
    '--',
    'psql',
    '-U',
    'automation',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-c',
    statement,
  ]);
}
type Deployment = { metadata: { name: string }; spec: { replicas?: number } };

export async function createControlledSnapshot() {
  await requireControlledSnapshotScope();
  const { stdout } = await kubectl([
    'get',
    'deployment',
    '-l',
    'app.kubernetes.io/instance=automation',
    '-o',
    'json',
  ]);
  const deployments = (JSON.parse(stdout) as { items: Deployment[] }).items.map(d => ({
    name: d.metadata.name,
    replicas: d.spec.replicas ?? 1,
  }));
  if (
    !deployments.length ||
    deployments.some(d => !d.name.startsWith('automation-') || d.replicas < 1)
  )
    throw new Error('All controlled fixture deployments must be running before snapshot capture');

  async function stop() {
    await kubectl([
      'scale',
      'deployment',
      '-l',
      'app.kubernetes.io/instance=automation',
      '--replicas=0',
    ]);
    for (let attempt = 0; attempt < 120; attempt++) {
      const { stdout: pods } = await kubectl([
        'get',
        'pods',
        '-l',
        'app.kubernetes.io/instance=automation',
        '-o',
        'json',
      ]);
      const active = (
        JSON.parse(pods) as {
          items: Array<{ metadata: { ownerReferences?: Array<{ kind: string }> } }>;
        }
      ).items.some(p => p.metadata.ownerReferences?.some(owner => owner.kind === 'ReplicaSet'));
      if (!active) return;
      await sleep(1000);
    }
    throw new Error('Fixture application replicas did not stop before restoration');
  }
  async function start() {
    for (const d of deployments)
      await kubectl(['scale', `deployment/${d.name}`, `--replicas=${d.replicas}`]);
    await kubectl([
      'rollout',
      'status',
      'deployment',
      '-l',
      'app.kubernetes.io/instance=automation',
      '--timeout=150s',
    ]);
    // Identical startup settling; cold ingestion/version-cache costs remain measured.
    let healthySamples = 0;
    for (let attempt = 0; attempt < 60 && healthySamples < 15; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:3439/api/health', {
          signal: AbortSignal.timeout(5000),
        });
        healthySamples = response.ok ? healthySamples + 1 : 0;
      } catch {
        healthySamples = 0;
      }
      await sleep(2000);
    }
    if (healthySamples < 15) throw new Error('Controlled fixture failed consecutive health warmup');
  }
  let forward: ChildProcess | undefined;
  await stop();
  try {
    const { stdout: clean } = await kubectl([
      'exec',
      'automation-postgresql-0',
      '--',
      'psql',
      '-U',
      'automation',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      `SELECT (SELECT count(*) FROM "Incident" WHERE title='Automation capacity certification'),
              (SELECT count(*) FROM "IncidentAutomationDecision"), (SELECT count(*) FROM "AutomationTrace")`,
    ]);
    if (clean.trim() !== '0|0|0')
      throw new Error('Snapshot source contains previous capacity history; seed a fresh database');
    await kubectl([
      'exec',
      'automation-postgresql-0',
      '--',
      'psql',
      '-U',
      'automation',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE "Incident" SET "escalationStatus"='COMPLETED', "nextEscalationAt"=NULL
       WHERE title LIKE '[LoadCert #%'`,
    ]);
    await sql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND pid<>pg_backend_pid()`
    );
    await sql(`DROP DATABASE IF EXISTS ${snapshot} WITH (FORCE)`);
    await sql(`CHECKPOINT`);
    await sql(`CREATE DATABASE ${snapshot} TEMPLATE ${database}`);
    await sql(`ALTER DATABASE ${snapshot} ALLOW_CONNECTIONS false`);
  } catch (error) {
    await start();
    throw error;
  }
  return {
    close() {
      forward?.kill('SIGTERM');
    },
    evidence: {
      database,
      snapshot,
      scope: 'owned Kind fixture',
      settlingSeconds: 30,
      ingestionColdStartIncluded: true,
    },
    async restore() {
      await requireControlledSnapshotScope();
      await stop();
      // Fixed identifiers only. No application outside this fixture is terminated.
      await sql(`DROP DATABASE ${database} WITH (FORCE)`);
      await sql(`CREATE DATABASE ${database} TEMPLATE ${snapshot}`);
      const { stdout: restored } = await kubectl([
        'exec',
        'automation-postgresql-0',
        '--',
        'psql',
        '-U',
        'automation',
        '-d',
        database,
        '-At',
        '-c',
        `SELECT (SELECT count(*) FROM "Incident" WHERE title='Automation capacity certification'),
          (SELECT count(*) FROM "IncidentAutomationDecision"), (SELECT count(*) FROM "AutomationTrace")`,
      ]);
      if (restored.trim() !== '0|0|0')
        throw new Error('Restored database is not equivalent to the clean seed');
      await sql('CHECKPOINT');
      // Reset shared buffers and server lifetime without changing durable settings.
      await kubectl(['delete', 'pod', 'automation-postgresql-0', '--wait=true']);
      await kubectl(['rollout', 'status', 'statefulset/automation-postgresql', '--timeout=150s']);
      forward?.kill('SIGTERM');
      forward = spawn(
        'kubectl',
        [
          '--context',
          'kind-opsknight-automation',
          '-n',
          namespace,
          'port-forward',
          'service/automation-postgresql',
          '55443:5432',
          '--address',
          '127.0.0.1',
        ],
        { stdio: 'ignore' }
      );
      await sleep(2000);
      if (forward.exitCode !== null) throw new Error('Controlled database forwarding failed');
      await start();
    },
  };
}
