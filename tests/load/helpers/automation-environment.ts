import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function captureControlledEnvironment() {
  const args = ['--context', 'kind-opsknight-automation', '-n', 'automation-cert'];
  const { stdout } = await exec('kubectl', [...args, 'get', 'pods', '-o', 'json']);
  const pods = (
    JSON.parse(stdout) as {
      items: Array<{
        metadata: { name: string; uid: string };
        spec: { containers: Array<{ name: string; image: string; resources: unknown }> };
        status: {
          phase: string;
          containerStatuses?: Array<{
            name: string;
            ready: boolean;
            imageID: string;
            containerID: string;
          }>;
        };
      }>;
    }
  ).items
    .filter(p => p.status.phase === 'Running')
    .map(p => ({
      name: p.metadata.name,
      uid: p.metadata.uid,
      containers: p.spec.containers.map(c => ({
        name: c.name,
        image: c.image,
        resources: c.resources,
        status: p.status.containerStatuses?.find(s => s.name === c.name),
      })),
    }));
  if (!pods.length || pods.some(p => p.containers.some(c => !c.status?.ready || !c.status.imageID)))
    throw new Error('Missing ready replica/image identity metadata');
  const version = await exec('kubectl', [
    ...args,
    'exec',
    'automation-postgresql-0',
    '--',
    'psql',
    '-U',
    'automation',
    '-d',
    'postgres',
    '-At',
    '-c',
    'SELECT version()',
  ]);
  const identity = await exec('kubectl', [
    ...args,
    'exec',
    'automation-postgresql-0',
    '--',
    'psql',
    '-U',
    'automation',
    '-d',
    'postgres',
    '-At',
    '-c',
    "SELECT oid::text FROM pg_database WHERE datname='automation_cert_snapshot' AND NOT datallowconn",
  ]);
  if (!identity.stdout.trim()) throw new Error('Missing immutable snapshot identity');
  // Capture container identity and utilization only, never environment/commands.
  const host = await exec('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
  const containers = host.stdout
    .trim()
    .split('\n')
    .map(line => {
      const item = JSON.parse(line) as {
        Name: string;
        ID: string;
        CPUPerc: string;
        MemUsage: string;
      };
      return {
        name: item.Name,
        id: item.ID,
        cpuPercent: item.CPUPerc,
        memory: item.MemUsage,
        concurrentWorkload: item.Name !== 'opsknight-automation-control-plane',
      };
    });
  return {
    capturedAt: new Date().toISOString(),
    postgresVersion: version.stdout.trim(),
    snapshotIdentity: identity.stdout.trim(),
    pods,
    hostContainers: containers,
    externalStateIsolation: 'OS scheduling/cache and other host workloads are observed, not reset',
  };
}

/** Config digests bind the full filesystem layer list and runtime config to the built image. */
export function assertControlledImageConfigs(expected: string, actual: string[]) {
  if (
    !/^sha256:[a-f0-9]{64}$/.test(expected) ||
    !actual.length ||
    actual.some(value => value !== expected)
  )
    throw new Error('Deployed application image does not match the declared built image');
}
export async function verifyControlledImage(
  expected: string,
  environment: Awaited<ReturnType<typeof captureControlledEnvironment>>
) {
  const application = environment.pods.filter(
    p => p.name.startsWith('automation-') && !p.name.startsWith('automation-postgresql')
  );
  const configIds: string[] = [];
  for (const pod of application)
    for (const container of pod.containers) {
      const reference = container.status?.imageID;
      if (!reference || !/^[a-zA-Z0-9./_:@-]+$/.test(reference))
        throw new Error('Missing deployed image identity');
      const inspected = await exec('docker', [
        'exec',
        'opsknight-automation-control-plane',
        'crictl',
        'inspecti',
        reference,
      ]);
      const parsed = JSON.parse(inspected.stdout) as { status: { id: string } };
      configIds.push(parsed.status.id);
    }
  assertControlledImageConfigs(expected, configIds);
  return { expectedConfigDigest: expected, verifiedConfigDigests: configIds };
}
