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
      const cli = config.runtime === 'podman' ? 'podman' : 'docker';
      let rawOut = '';
      try {
        rawOut = (
          await run(
            cli,
            [
              'inspect',
              '--format',
              containerEvidenceFormat(config.runtime),
              String(config.container),
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
      } catch {
        rawOut = (
          await run(
            cli,
            ['inspect', '--format', '{{json .State}}', String(config.container)],
            { timeout: 2000, maxBuffer: 65536, signal }
          )
        ).stdout.trim();
      }
      try {
        const parsed = JSON.parse(rawOut) as Record<string, unknown>;
        const health =
          parsed.Health && typeof parsed.Health === 'object'
            ? (parsed.Health as Record<string, unknown>)
            : parsed.Healthcheck && typeof parsed.Healthcheck === 'object'
              ? (parsed.Healthcheck as Record<string, unknown>)
              : null;
        const healthStatus = health?.Status ? String(health.Status) : undefined;
        state.containerState = JSON.stringify({
          Running: Boolean(parsed.Running),
          Paused: Boolean(parsed.Paused),
          Restarting: Boolean(parsed.Restarting),
          Dead: Boolean(parsed.Dead),
          Health: healthStatus ? { Status: healthStatus } : null,
        });
      } catch {
        state.containerState = rawOut.slice(0, 4096);
      }
    } else if (attempt.step.type === 'KUBERNETES') {
      const resource = String(config.resource ?? 'pods').toLowerCase();
      const namespace = String(config.namespace ?? 'default');
      const name = String(config.name ?? '');
      if (!name) throw new Error('Kubernetes evidence requires a resource name.');

      if (['deployment', 'deployments'].includes(resource)) {
        const output = (
          await run(
            'kubectl',
            [
              '-n',
              namespace,
              'get',
              `deployment/${name}`,
              '-o',
              'jsonpath={.spec.replicas}{"|"}{.status.updatedReplicas}{"|"}{.status.availableReplicas}{"|"}{.status.readyReplicas}{"|"}{.status.observedGeneration}{"|"}{.metadata.generation}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const [desired, updated, available, readyReplicas, observedGeneration, generation] = output
          .split('|')
          .map(value => (value === '' ? 0 : Number(value)));
        if (
          [desired, updated, available, readyReplicas, observedGeneration, generation].some(
            value => !Number.isInteger(value) || value < 0
          )
        )
          throw new Error('Invalid Kubernetes evidence.');
        const converged =
          desired === 0
            ? updated === 0 && available === 0
            : updated >= desired && available >= desired && observedGeneration >= generation;
        state.kubernetesState = {
          desired,
          ready: converged ? Math.max(available, readyReplicas) : 0,
          observedGeneration,
          generation,
        };
      } else if (['statefulset', 'statefulsets'].includes(resource)) {
        const output = (
          await run(
            'kubectl',
            [
              '-n',
              namespace,
              'get',
              `statefulset/${name}`,
              '-o',
              'jsonpath={.spec.replicas}{"|"}{.status.updatedReplicas}{"|"}{.status.readyReplicas}{"|"}{.status.currentRevision}{"|"}{.status.updateRevision}{"|"}{.status.observedGeneration}{"|"}{.metadata.generation}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const parts = output.split('|');
        const desired = Number(parts[0] || '0');
        const updated = Number(parts[1] || '0');
        const readyReplicas = Number(parts[2] || '0');
        const currentRevision = parts[3] || '';
        const updateRevision = parts[4] || '';
        const observedGeneration = Number(parts[5] || '0');
        const generation = Number(parts[6] || '0');
        if (
          [desired, updated, readyReplicas, observedGeneration, generation].some(
            value => !Number.isInteger(value) || value < 0
          )
        )
          throw new Error('Invalid StatefulSet evidence.');
        const revisionMatch =
          desired === 0
            ? true
            : Boolean(currentRevision) && Boolean(updateRevision) && currentRevision === updateRevision;
        const converged =
          desired === 0
            ? updated === 0 && readyReplicas === 0
            : updated >= desired && readyReplicas >= desired && revisionMatch && observedGeneration >= generation;
        state.kubernetesState = {
          desired,
          ready: converged ? readyReplicas : 0,
          observedGeneration,
          generation,
        };
      } else if (['daemonset', 'daemonsets'].includes(resource)) {
        const output = (
          await run(
            'kubectl',
            [
              '-n',
              namespace,
              'get',
              `daemonset/${name}`,
              '-o',
              'jsonpath={.status.desiredNumberScheduled}{"|"}{.status.updatedNumberScheduled}{"|"}{.status.numberReady}{"|"}{.status.observedGeneration}{"|"}{.metadata.generation}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const [desired, updated, readyPods, observedGeneration, generation] = output
          .split('|')
          .map(value => (value === '' ? 0 : Number(value)));
        if (
          [desired, updated, readyPods, observedGeneration, generation].some(
            value => !Number.isInteger(value) || value < 0
          )
        )
          throw new Error('Invalid DaemonSet evidence.');
        const converged =
          desired === 0
            ? updated === 0 && readyPods === 0
            : updated >= desired && readyPods >= desired && observedGeneration >= generation;
        state.kubernetesState = {
          desired,
          ready: converged ? readyPods : 0,
          observedGeneration,
          generation,
        };
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
              'jsonpath={.status.phase}{"|"}{range .status.conditions[?(@.type=="Ready")]}{.status}{end}{"|"}{range .status.containerStatuses[*]}{.ready}{","}{end}',
            ],
            { timeout: 2000, maxBuffer: 4096, signal }
          )
        ).stdout.trim();
        const [phase, readyCondition, containerReadies] = output.split('|');
        const containers = containerReadies
          ? containerReadies.split(',').filter(Boolean)
          : [];
        const isReady =
          phase === 'Running' &&
          readyCondition === 'True' &&
          (containers.length === 0 || containers.every(c => c === 'true'));
        state.kubernetesState = {
          desired: 1,
          ready: isReady ? 1 : 0,
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
