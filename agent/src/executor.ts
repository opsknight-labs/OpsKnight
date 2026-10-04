import { spawn } from 'node:child_process';
import type { AgentPolicy, ClaimedAttempt } from './types';

export interface ExecutionResult {
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  exitCode?: number;
  output: string;
  errorCode?: string;
  errorMessage?: string;
}

function commandFor(attempt: ClaimedAttempt): { command: string; args: string[] } {
  const config = attempt.step.config;
  switch (attempt.step.type) {
    case 'LINUX_DIAGNOSTICS': {
      const diagnostic = String(config.diagnostic ?? 'summary');
      const commands: Record<string, { command: string; args: string[] }> = {
        summary: { command: 'sh', args: ['-c', 'uptime; df -h; free -m'] },
        disk: { command: 'df', args: ['-h'] },
        memory: { command: 'free', args: ['-m'] },
        processes: { command: 'ps', args: ['aux'] },
        network: { command: 'ss', args: ['-tunap'] },
      };
      const selected = Object.entries(commands).find(([key]) => key === diagnostic)?.[1];
      if (!selected) throw new Error(`Unsupported diagnostic: ${diagnostic}`);
      return selected;
    }
    case 'SYSTEMD': {
      const action = String(config.action ?? 'status');
      if (!['status', 'start', 'stop', 'restart'].includes(action)) {
        throw new Error(`Unsupported systemd action: ${action}`);
      }
      return { command: 'systemctl', args: [action, String(config.unit)] };
    }
    case 'DOCKER': {
      const action = String(config.action ?? 'inspect');
      if (!['inspect', 'logs', 'restart', 'start', 'stop'].includes(action)) {
        throw new Error(`Unsupported Docker action: ${action}`);
      }
      const args =
        action === 'logs'
          ? ['logs', '--tail', '500', String(config.container)]
          : [action, String(config.container)];
      return { command: 'docker', args };
    }
    case 'KUBERNETES': {
      const action = String(config.action ?? 'get');
      const namespace = String(config.namespace ?? 'default');
      const resource = String(config.resource ?? 'pods');
      const name = config.name ? String(config.name) : '';
      if (action === 'rollout-restart') {
        if (!name) throw new Error('Kubernetes rollout restart requires a resource name.');
        return {
          command: 'kubectl',
          args: ['-n', namespace, 'rollout', 'restart', `${resource}/${name}`],
        };
      }
      if (!['get', 'describe', 'logs'].includes(action)) {
        throw new Error(`Unsupported Kubernetes action: ${action}`);
      }
      return {
        command: 'kubectl',
        args: [
          '-n',
          namespace,
          action,
          resource,
          ...(name ? [name] : []),
          ...(action === 'logs' ? ['--tail=500'] : []),
        ],
      };
    }
    case 'BASH':
      return { command: 'sh', args: ['-c', String(config.command)] };
  }
}

export async function executeAttempt(
  attempt: ClaimedAttempt,
  policy: AgentPolicy,
  signal: AbortSignal
): Promise<ExecutionResult> {
  if (signal.aborted) {
    return { status: 'CANCELLED', output: '', errorCode: 'CANCELLED_BEFORE_START' };
  }
  const spec = commandFor(attempt);
  const configuredTimeout = attempt.step.timeoutSeconds ?? policy.maxRuntimeSeconds;
  const timeoutMs = Math.min(configuredTimeout, policy.maxRuntimeSeconds) * 1000;
  const inputEnvironment = Object.fromEntries(
    Object.entries(attempt.inputValues).map(([key, value]) => [
      `OPSKNIGHT_INPUT_${key.toUpperCase()}`,
      typeof value === 'string' ? value : JSON.stringify(value),
    ])
  );
  return new Promise(resolve => {
    const child = spawn(spec.command, spec.args, {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ...inputEnvironment,
        PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    const collect = (chunk: Buffer) => {
      if (bytes >= policy.maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = policy.maxOutputBytes - bytes;
      chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) truncated = true;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const killGroup = () => {
      if (!child.pid) return;
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
      } catch {
        // The process may have exited between the state check and signal.
      }
      setTimeout(() => {
        if (!child.pid) return;
        try {
          process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
        } catch {
          // The process exited during the termination grace period.
        }
      }, 5_000);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    signal.addEventListener('abort', killGroup, { once: true });
    child.once('error', error => {
      clearTimeout(timeout);
      resolve({
        status: 'FAILED',
        output: '',
        errorCode: 'EXECUTOR_START_FAILED',
        errorMessage: error.message,
      });
    });
    child.once('close', code => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', killGroup);
      const output =
        Buffer.concat(chunks).toString('utf8') + (truncated ? '\n[output truncated]' : '');
      if (signal.aborted)
        return resolve({
          status: signal.reason === 'LEASE_LOST' ? 'UNKNOWN' : 'CANCELLED',
          exitCode: code ?? undefined,
          output,
          ...(signal.reason === 'LEASE_LOST'
            ? { errorCode: 'LEASE_LOST', errorMessage: 'Local execution authority expired.' }
            : {}),
        });
      if (timedOut) {
        return resolve({
          status: attempt.step.riskClass === 'READ_ONLY' ? 'FAILED' : 'UNKNOWN',
          exitCode: code ?? undefined,
          output,
          errorCode: 'COMMAND_TIMEOUT',
          errorMessage: `Command exceeded ${Math.floor(timeoutMs / 1000)} seconds.`,
        });
      }
      resolve({
        status:
          code === 0 ? 'SUCCEEDED' : attempt.step.riskClass === 'READ_ONLY' ? 'FAILED' : 'UNKNOWN',
        exitCode: code ?? undefined,
        output,
        ...(code === 0
          ? {}
          : {
              errorCode: 'COMMAND_FAILED',
              errorMessage: `Command exited with ${code ?? 'unknown'}.`,
            }),
      });
    });
  });
}
