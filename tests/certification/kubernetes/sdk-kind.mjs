// Run the existing SDK workflows through forwards bound to one owned Kind namespace.
// Secret values stay in process memory and child environments, never command arguments/logs.
import { spawn, spawnSync } from 'node:child_process';

const context = 'kind-opsknight-cluster';
const namespace = process.env.API_SDK_KUBERNETES_NAMESPACE;
const revision = process.env.API_SDK_SOURCE_REVISION;
if (
  !/^opsknight-api-[0-9]+-[a-f0-9]{7}$/.test(namespace ?? '') ||
  !/^[a-f0-9]{40}$/.test(revision ?? '')
)
  throw new Error('Explicit certification namespace and source revision are required.');
function kubectl(args) {
  const result = spawnSync('kubectl', ['--context', context, '--request-timeout=15s', ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.status !== 0) throw new Error('Namespaced Kubernetes preflight failed.');
  return JSON.parse(result.stdout);
}
const metadata = kubectl(['get', 'namespace', namespace, '-o', 'json']).metadata;
if (
  metadata.labels?.['opsknight.com/owner'] !== 'codex' ||
  metadata.labels?.['opsknight.com/source-revision'] !== revision
)
  throw new Error(
    'Namespace ownership/source revision does not match the requested certification.'
  );
const deployments = kubectl(['-n', namespace, 'get', 'deployments', '-o', 'json']).items;
for (const role of [
  'web',
  'scheduler',
  'general-worker',
  'critical-worker',
  'bulk-worker',
  'runbook-worker',
  'status-projector',
]) {
  const deployment = deployments.find(item => item.metadata.name === `api-cert-${role}`);
  const desired = deployment?.spec.replicas ?? 0;
  if (
    !desired ||
    deployment.status?.observedGeneration !== deployment.metadata.generation ||
    (deployment.status?.availableReplicas ?? 0) !== desired ||
    (deployment.status?.updatedReplicas ?? 0) !== desired ||
    deployment.spec.template.spec.containers[0].image !== `opsknight-pr886:${revision.slice(0, 9)}`
  )
    throw new Error(
      'All certification runtime roles must be ready on the requested image revision.'
    );
}
const secret = kubectl(['-n', namespace, 'get', 'secret', 'api-cert-secrets', '-o', 'json']);
const readSecret = value => {
  if (typeof value !== 'string') throw new Error('Required certification secret is absent.');
  return Buffer.from(value, 'base64').toString('utf8');
};
const port = 3160;
const databasePort = 55443;
const database = new URL(readSecret(secret.data?.DIRECT_DATABASE_URL));
if (!database.pathname.endsWith('_test')) throw new Error('A dedicated test database is required.');
database.hostname = '127.0.0.1';
database.port = String(databasePort);
const forwards = [];
function waitForForward(child, port) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Certification forward timed out.')), 30_000);
    let output = '';
    function finish(error) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    }
    function onData(chunk) {
      output = (output + chunk.toString()).slice(-4096);
      if (output.includes(`Forwarding from 127.0.0.1:${port} ->`)) finish();
    }
    function onExit() {
      finish(new Error('Certification forward exited before readiness.'));
    }
    function onError() {
      finish(new Error('Certification forward could not start.'));
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

try {
  const ready = [];
  for (const [service, localPort, remotePort] of [
    ['api-cert-proxy', port, 3000],
    ['api-cert-postgresql', databasePort, 5432],
  ]) {
    const forward = spawn(
      'kubectl',
      [
        '--context',
        context,
        '-n',
        namespace,
        'port-forward',
        `service/${service}`,
        `${localPort}:${remotePort}`,
        '--address=127.0.0.1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    forwards.push(forward);
    ready.push(waitForForward(forward, localPort));
  }
  await Promise.all(ready);
  const child = spawn(process.execPath, ['tests/sdk/live-workflows.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: database.toString(),
      API_KEY_SECRET: readSecret(secret.data?.API_KEY_SECRET),
      API_SDK_TEST_PORT: String(port),
      API_SDK_EXTERNAL_BASE_URL: `http://127.0.0.1:${port}/api/v2`,
      API_SDK_KUBERNETES_CONTEXT: context,
    },
  });
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (status !== 0) throw new Error('Namespaced SDK certification failed.');
  console.log(`Both SDK workflows passed in ${namespace} at application revision ${revision}.`);
} finally {
  for (const child of forwards) child.kill('SIGTERM');
}
