import { spawn } from 'node:child_process';
import type { AgentPolicy, ClaimedAttempt } from './types';
import { executeNetworkDiagnostic } from './network-diagnostics';
import { captureEvidence } from './evidence';
import { assertPolicyAllows } from './policy';


export interface ExecutionResult {
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  exitCode?: number;
  output: string;
  errorCode?: string;
  errorMessage?: string;
  preState?: Record<string, unknown>;
  postState?: Record<string, unknown>;
}

export function containerHealthPassed(output: string): boolean {
  try {
    const trimmed = output.trim();
    if (!trimmed) return false;
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed.toLowerCase() === 'healthy';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const state = parsed as Record<string, unknown>;
      const healthObj = (state.Health ?? state.Healthcheck ?? state.health ?? state.healthcheck) as
        | Record<string, unknown>
        | undefined;
      if (healthObj && typeof healthObj === 'object') {
        const status = String(healthObj.Status ?? healthObj.status ?? '');
        return status.toLowerCase() === 'healthy';
      }
      if (typeof state.Status === 'string') return state.Status.toLowerCase() === 'healthy';
      if (typeof state.status === 'string') return state.status.toLowerCase() === 'healthy';
    }
    return false;
  } catch {
    return false;
  }
}

export function commandFor(
  attempt: ClaimedAttempt,
  policy?: AgentPolicy
): { command: string; args: string[] } {
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
        listeners: { command: 'ss', args: ['-lntup'] },
        process: { command: 'pgrep', args: ['-a', '-f', '--', String(config.pattern ?? '')] },
        filesystem: { command: 'df', args: ['-P', '--', String(config.path ?? '/')] },
        journal: {
          command: 'journalctl',
          args: [
            '--no-pager',
            '--unit',
            String(config.unit),
            '--lines',
            String(Math.min(500, Math.max(1, Number(config.lines ?? 100)))),
          ],
        },
      };
      const selected = Object.entries(commands).find(([key]) => key === diagnostic)?.[1];
      if (!selected) throw new Error(`Unsupported diagnostic: ${diagnostic}`);
      return selected;
    }
    case 'SYSTEMD': {
      const action = String(config.action ?? 'status');
      if (action === 'logs')
        return {
          command: 'journalctl',
          args: [
            '--no-pager',
            '--unit',
            String(config.unit),
            '--lines',
            String(Math.min(500, Math.max(1, Number(config.lines ?? 100)))),
          ],
        };
      if (!['status', 'start', 'stop', 'restart'].includes(action)) {
        throw new Error(`Unsupported systemd action: ${action}`);
      }
      return { command: 'systemctl', args: [action, String(config.unit)] };
    }
    case 'DOCKER': {
      const action = String(config.action ?? 'inspect');
      if (!['inspect', 'logs', 'health', 'restart', 'start', 'stop'].includes(action)) {
        throw new Error(`Unsupported Docker action: ${action}`);
      }
      const args =
        action === 'logs'
          ? ['logs', '--tail', '500', String(config.container)]
          : action === 'health'
            ? [
                'inspect',
                '--format',
                '{{json .State}}',
                String(config.container),
              ]
            : [action, String(config.container)];
      return { command: config.runtime === 'podman' ? 'podman' : 'docker', args };
    }
    case 'KUBERNETES': {
      const action = String(config.action ?? 'get');
      const namespace = String(config.namespace ?? 'default');
      const resource = String(config.resource ?? 'pods');
      const name = config.name ? String(config.name) : '';
      if (action === 'scale')
        return {
          command: 'kubectl',
          args: ['-n', namespace, 'scale', `${resource}/${name}`, `--replicas=${config.replicas}`],
        };
      if (action === 'events') {
        const args = ['-n', namespace, 'get', 'events'];
        if (name) {
          args.push('--field-selector', `involvedObject.name=${name}`);
        }
        return {
          command: 'kubectl',
          args,
        };
      }
      if (action === 'rollout-status')
        return {
          command: 'kubectl',
          args: ['-n', namespace, 'rollout', 'status', `${resource}/${name}`, '--timeout=30s'],
        };
      if (action === 'rollout-restart') {
        if (!name) throw new Error('Kubernetes rollout restart requires a resource name.');
        return {
          command: 'kubectl',
          args: ['-n', namespace, 'rollout', 'restart', `${resource}/${name}`],
        };
      }
      if (action === 'logs') {
        if (!name) throw new Error('Kubernetes logs requires a target resource name.');
        const target = ['pod', 'pods'].includes(resource.toLowerCase()) ? name : `${resource}/${name}`;
        return {
          command: 'kubectl',
          args: [
            '-n',
            namespace,
            'logs',
            target,
            '--tail=500',
            '--limit-bytes=262144',
          ],
        };
      }
      if (!['get', 'describe'].includes(action)) {
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
        ],
      };
    }
    case 'BASH': {
      // Execute the operator-owned allowlist entry, never the remote claim's command string.
      const approvedCommand = policy?.bashCommandPatterns.find(
        command => command === config.command
      );
      if (approvedCommand === undefined)
        throw new Error('LOCAL_POLICY_DENIED: shell command is not allowlisted.');
      return { command: 'bash', args: ['--noprofile', '--norc', '-c', approvedCommand] };
    }
  }
}

export async function executeAttempt(
  attempt: ClaimedAttempt,
  policy: AgentPolicy,
  signal: AbortSignal
): Promise<ExecutionResult> {
  assertPolicyAllows(attempt, policy);
  if (
    attempt.step.riskClass !== 'READ_ONLY' ||
    ['LINUX_DIAGNOSTICS', 'SYSTEMD', 'DOCKER', 'KUBERNETES'].includes(attempt.step.type)
  ) {
    const preState = await captureEvidence(attempt, signal);
    const result = await executeCommand(attempt, policy, signal);
    if (
      result.status === 'SUCCEEDED' &&
      attempt.step.type === 'DOCKER' &&
      attempt.step.config.action === 'health' &&
      !containerHealthPassed(result.output)
    ) {
      result.status = 'FAILED';
      result.errorCode = 'CONTAINER_UNHEALTHY';
      result.errorMessage =
        'Container healthcheck is unhealthy, starting, unavailable or not configured.';
    }
    const postState = { ...(await captureEvidence(attempt, signal)), ...result.postState };
    const diagnostic = attempt.step.config.diagnostic;
    if (result.status === 'SUCCEEDED' && attempt.step.type === 'LINUX_DIAGNOSTICS') {
      if (diagnostic === 'disk' || diagnostic === 'filesystem')
        postState.disk = result.output.slice(0, 4096);
      if (diagnostic === 'process' || diagnostic === 'processes')
        postState.processes = result.output.slice(0, 4096);
      if (diagnostic === 'journal') postState.logSummary = result.output.slice(0, 4096);
    }
    if (
      result.status === 'SUCCEEDED' &&
      attempt.step.type === 'SYSTEMD' &&
      attempt.step.config.action === 'logs'
    )
      postState.logSummary = result.output.slice(0, 4096);
    if (signal.aborted && result.status === 'SUCCEEDED')
      return {
        ...result,
        preState,
        postState,
        status: 'UNKNOWN',
        errorCode: 'AUTHORITY_LOST_DURING_EVIDENCE',
      };
    return { ...result, preState, postState };
  }
  return executeCommand(attempt, policy, signal);
}

async function executeCommand(
  attempt: ClaimedAttempt,
  policy: AgentPolicy,
  signal: AbortSignal
): Promise<ExecutionResult> {
  if (signal.aborted) {
    const isShutdown = signal.reason === 'AGENT_SHUTDOWN';
    return {
      status: 'CANCELLED',
      output: '',
      errorCode: isShutdown ? 'AGENT_INTERRUPTED_BY_SHUTDOWN' : 'CANCELLED_BEFORE_START',
      errorMessage: isShutdown ? 'Execution interrupted by shutdown before start.' : undefined,
    };
  }
  if (
    attempt.step.type === 'LINUX_DIAGNOSTICS' &&
    ['dns', 'tcp', 'http'].includes(String(attempt.step.config.diagnostic))
  )
    return executeNetworkDiagnostic(attempt, policy, signal);
  const spec = commandFor(attempt, policy);
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
        // Non-interactive Bash otherwise sources an inherited BASH_ENV before the approved command.
        ...(attempt.step.type === 'BASH' ? { BASH_ENV: '/dev/null' } : {}),
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
      if (signal.aborted) {
        const isShutdown = signal.reason === 'AGENT_SHUTDOWN';
        const isLeaseLost = signal.reason === 'LEASE_LOST';
        const isWrite = attempt.step.riskClass !== 'READ_ONLY';
        const status = isLeaseLost || (isShutdown && isWrite) ? 'UNKNOWN' : 'CANCELLED';
        const errorCode = isShutdown
          ? isWrite
            ? 'AGENT_INTERRUPTED_BY_SHUTDOWN'
            : 'AGENT_SHUTDOWN'
          : isLeaseLost
            ? 'LEASE_LOST'
            : undefined;
        const errorMessage = isShutdown
          ? isWrite
            ? 'Execution was interrupted by process shutdown; target state is unknown.'
            : 'Execution was cancelled by process shutdown.'
          : isLeaseLost
            ? 'Local execution authority expired.'
            : undefined;

        return resolve({
          status,
          exitCode: code ?? undefined,
          output,
          ...(errorCode ? { errorCode, errorMessage } : {}),
        });
      }
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
