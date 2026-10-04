import { cpus, freemem, totalmem, loadavg } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClaimedAttempt } from './types';

const run = promisify(execFile);
export function containerEvidenceFormat(runtime: unknown): string {
  const health = runtime === 'podman' ? 'Healthcheck' : 'Health';
  // Project bounded state: raw health logs may be large and belong in output artifacts.
  return `{"Running":{{json .State.Running}},"Paused":{{json .State.Paused}},"Restarting":{{json .State.Restarting}},"Dead":{{json .State.Dead}},"Health":{{if .State.${health}}}{"Status":{{json .State.${health}.Status}}}{{else}}null{{end}}}`;
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
      const output = (
        await run(
          'kubectl',
          [
            '-n',
            String(config.namespace ?? 'default'),
            'get',
            `${config.resource}/${config.name}`,
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
    }
  } catch {
    state.captureError = 'Relevant target state could not be captured.';
  }
  return state;
}
