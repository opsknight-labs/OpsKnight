import { cpus, freemem, totalmem, loadavg } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClaimedAttempt } from './types';

const run = promisify(execFile);
export function containerEvidenceFormat(_runtime?: unknown): string {
  // Project bounded state: raw health logs may be large and belong in output artifacts.
  // Supports both Docker (.State.Health) and Podman (.State.Health or .State.Healthcheck) versions.
  return `{"Running":{{json .State.Running}},"Paused":{{json .State.Paused}},"Restarting":{{json .State.Restarting}},"Dead":{{json .State.Dead}},"Health":{{if .State.Health}}{"Status":{{json .State.Health.Status}}}{{else if .State.Healthcheck}}{"Status":{{json .State.Healthcheck.Status}}}{{else}}null{{end}}}`;
}
export async function captureEvidence(
  attempt: ClaimedAttempt,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    cpu: { load1: loadavg()[0], cores: cpus().length || 1 },
    memory: { usedBytes: totalmem() - freemem(), totalBytes: totalmem() },
    load: loadavg(),
  };
  const config = attempt.step.config;
  try {
    if (attempt.step.type === 'SYSTEMD') {
      state.serviceState = (
        await run('systemctl', ['show', '--property=ActiveState', '--value', String(config.unit)], {
          timeout: 2000,
          maxBuffer: 4096,
          signal,
        })
      ).stdout.trim();
    } else if (attempt.step.type === 'DOCKER') {
      state.containerState = (
        await run(
          config.runtime === 'podman' ? 'podman' : 'docker',
          [
            'inspect',
            '--format',
            containerEvidenceFormat(config.runtime),
            String(config.container),
          ],
          { timeout: 2000, maxBuffer: 4096, signal }
        )
      ).stdout.trim();
    } else if (attempt.step.type === 'KUBERNETES') {
      const resource = String(config.resource ?? 'pods').toLowerCase();
      const namespace = String(config.namespace ?? 'default');
      const name = String(config.name ?? '');
      if (!name) throw new Error('Kubernetes evidence requires a resource name.');

      if (['deployment', 'deployments', 'statefulset', 'statefulsets'].includes(resource)) {
        const output = (
          await run(
            'kubectl',
            [
              '-n',
              namespace,
              'get',
              `${config.resource}/${name}`,
              '-o',
              'jsonpath={.spec.replicas}{"|"}{.status.readyReplicas}{"|"}{.status.observedGeneration}{"|"}{.metadata.generation}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const [desired, ready, observedGeneration, generation] = output
          .split('|')
          .map(value => (value === '' ? 0 : Number(value)));
        if (
          [desired, ready, observedGeneration, generation].some(
            value => !Number.isInteger(value) || value < 0
          )
        )
          throw new Error('Invalid Kubernetes evidence.');
        state.kubernetesState = { desired, ready, observedGeneration, generation };
      } else if (['daemonset', 'daemonsets'].includes(resource)) {
        const output = (
          await run(
            'kubectl',
            [
              '-n',
              namespace,
              'get',
              `${config.resource}/${name}`,
              '-o',
              'jsonpath={.status.desiredNumberScheduled}{"|"}{.status.numberReady}{"|"}{.status.observedGeneration}{"|"}{.metadata.generation}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const [desired, ready, observedGeneration, generation] = output
          .split('|')
          .map(value => (value === '' ? 0 : Number(value)));
        if (
          [desired, ready, observedGeneration, generation].some(
            value => !Number.isInteger(value) || value < 0
          )
        )
          throw new Error('Invalid DaemonSet evidence.');
        state.kubernetesState = { desired, ready, observedGeneration, generation };
      } else if (['pod', 'pods'].includes(resource)) {
        const output = (
          await run(
            'kubectl',
            [
              '-n',
              namespace,
              'get',
              `pod/${name}`,
              '-o',
              'jsonpath={.status.phase}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const isRunning = output === 'Running';
        state.kubernetesState = {
          desired: 1,
          ready: isRunning ? 1 : 0,
          observedGeneration: 1,
          generation: 1,
        };
      } else {
        throw new Error(`Unsupported Kubernetes resource "${resource}" for verification evidence.`);
      }
    }
  } catch {
    state.captureError = 'Relevant target state could not be captured.';
  }
  return state;
}
