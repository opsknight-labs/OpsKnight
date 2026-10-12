import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureHostPressure } from './automation-host-pressure';
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
  const cpuPlacement = await Promise.all(
    pods.map(async pod => {
      try {
        const result = await exec(
          'kubectl',
          [...args, 'exec', pod.name, '--', 'cat', '/sys/fs/cgroup/cpuset.cpus.effective'],
          { timeout: 5000, maxBuffer: 1024 }
        );
        const cpus = result.stdout.trim();
        if (!/^[0-9,-]+$/.test(cpus)) throw new Error('Missing CPU placement');
        return { pod: pod.name, status: 'AVAILABLE' as const, cpus };
      } catch {
        return { pod: pod.name, status: 'UNAVAILABLE' as const };
      }
    })
  );
  return {
    capturedAt: new Date().toISOString(),
    postgresVersion: version.stdout.trim(),
    snapshotIdentity: identity.stdout.trim(),
    pods,
    hostContainers: containers,
    hostPressure: await captureHostPressure(),
    cpuPlacement,
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
  environment: Awaited<ReturnType<typeof captureControlledEnvironment>>,
  loadGenerator?: { pod: string; imageConfigDigest: string }
) {
  const clientPod = process.env.AUTOMATION_K6_KUBERNETES_POD;
  if (
    (clientPod &&
      (clientPod !== 'k6-automation-cert' || !loadGenerator || loadGenerator.pod !== clientPod)) ||
    (loadGenerator && !clientPod)
  )
    throw new Error('Missing or inconsistent declared load-generator image provenance');
  const inventory = await exec('docker', [
    'exec',
    'opsknight-automation-control-plane',
    'crictl',
    'images',
    '-o',
    'json',
  ]);
  const images = (
    JSON.parse(inventory.stdout) as {
      images: Array<{ id: string; repoDigests?: string[] }>;
    }
  ).images;
  const application = environment.pods.filter(
    p => p.name.startsWith('automation-') && !p.name.startsWith('automation-postgresql')
  );
  const configIds: string[] = [];
  async function inspectConfig(reference: string | undefined) {
    if (!reference || !/^[a-zA-Z0-9./_:@-]+$/.test(reference))
      throw new Error('Missing deployed image identity');
    const inspected = await exec('docker', [
      'exec',
      'opsknight-automation-control-plane',
      'crictl',
      'inspecti',
      resolveControlledImageReference(reference, images),
    ]);
    const parsed = JSON.parse(inspected.stdout) as { status: { id: string } };
    return parsed.status.id;
  }
  for (const pod of application)
    for (const container of pod.containers)
      configIds.push(await inspectConfig(container.status?.imageID));
  assertControlledImageConfigs(expected, configIds);
  if (loadGenerator) {
    const pod = environment.pods.find(p => p.name === loadGenerator.pod);
    if (!pod || pod.containers.length !== 1) throw new Error('Missing owned load-generator pod');
    assertControlledImageConfigs(loadGenerator.imageConfigDigest, [
      await inspectConfig(pod.containers[0].status?.imageID),
    ]);
  }
  return { expectedConfigDigest: expected, verifiedConfigDigests: configIds };
}

/** Kind's imported repo digest is listed by CRI but may not be inspectable by alias. */
export function resolveControlledImageReference(
  reference: string,
  images: Array<{ id: string; repoDigests?: string[] }>
) {
  const matches = images.filter(
    image => image.id === reference || image.repoDigests?.includes(reference)
  );
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].id))
    throw new Error('Deployed image digest cannot be resolved unambiguously');
  return matches[0].id;
}
