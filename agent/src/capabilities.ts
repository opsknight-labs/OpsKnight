import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentPolicy } from './types';
const run = promisify(execFile);
export async function probeCapabilities(
  policy: AgentPolicy,
  probeCommand: (
    command: string,
    args: string[],
    options: { timeout: number; maxBuffer: number }
  ) => Promise<unknown> = run
) {
  const probes = [
    {
      type: 'SYSTEMD',
      name: 'Systemd',
      command: 'systemctl',
      args: ['show', '--property=Version', '--value'],
    },
    {
      type: 'DOCKER',
      name: 'Docker',
      command: 'docker',
      args: ['info', '--format', '{{.ServerVersion}}'],
    },
    {
      type: 'DOCKER',
      name: 'Podman',
      command: 'podman',
      args: ['info', '--format', '{{.Version.Version}}'],
    },
    {
      type: 'KUBERNETES',
      name: 'Kubernetes',
      command: 'kubectl',
      // cluster-info requires broad kube-system reads that a namespaced Agent may not have.
      args: ['get', '--raw=/version', '--request-timeout=2s'],
    },
    { type: 'BASH', name: 'Bash', command: 'bash', args: ['--version'] },
  ];
  const report = await Promise.all(
    probes.map(async probe => {
      const configured =
        policy.allowedStepTypes.includes(probe.type as AgentPolicy['allowedStepTypes'][number]) &&
        (probe.name !== 'Podman' || Boolean(policy.podmanContainers?.length)) &&
        (probe.name !== 'Docker' || Boolean(policy.dockerContainers.length));
      let available = false;
      if (configured) {
        try {
          await probeCommand(probe.command, probe.args, { timeout: 2500, maxBuffer: 4096 });
          available = true;
        } catch {
          /* No binary or runtime access. */
        }
      }
      return {
        name: probe.name,
        type: probe.type,
        configured,
        available,
        reason: available
          ? null
          : configured
            ? 'Binary or runtime access unavailable.'
            : 'Disabled by local policy.',
      };
    })
  );
  const diagnostics = policy.allowedStepTypes.includes('LINUX_DIAGNOSTICS');
  report.push({
    name: 'Linux diagnostics',
    type: 'LINUX_DIAGNOSTICS',
    configured: diagnostics,
    available: diagnostics && process.platform === 'linux',
    reason: process.platform === 'linux' ? null : 'Linux host required.',
  });
  return {
    report,
    capabilities: [
      ...(report.some(item => item.name === 'Podman' && item.available) ? ['RUNBOOK_PODMAN'] : []),
      ...(report.some(item => item.name === 'Docker' && item.available)
        ? ['RUNBOOK_DOCKER_RUNTIME']
        : []),
      ...new Set(
        report.filter(item => item.configured && item.available).map(item => `RUNBOOK_${item.type}`)
      ),
    ],
  };
}
