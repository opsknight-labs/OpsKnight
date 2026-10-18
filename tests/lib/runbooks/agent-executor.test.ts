import { describe, expect, it } from 'vitest';
import {
  containerHealthPassed,
  executeAttempt,
  isContainerStarting,
  sliceUtf8Safe,
} from '../../../agent/src/executor';
import type { AgentPolicy, ClaimedAttempt } from '../../../agent/src/types';

const policy: AgentPolicy = {
  allowedStepTypes: ['BASH'],
  allowNonIdempotent: false,
  systemdUnits: [],
  dockerContainers: [],
  kubernetesNamespaces: [],
  bashCommandPatterns: [
    'set -o pipefail; values=("$OPSKNIGHT_INPUT_ENV" ready); [[ "${values[0]}" == "prod" ]] && printf "%s" "${values[1]}"',
    'set -o pipefail; false | true',
    '[[ "$BASH_ENV" == /dev/null ]]',
    'printf "%s|%s" "$OPSKNIGHT_INPUT_SERVICE" "$OPSKNIGHT_INPUT_REPLICAS"',
    "printf '0123456789'",
    "printf 'x%.0s' {1..2000}",
    'head -c 10485800 /dev/zero',
    'exit 99',
    'sleep 30',
    'exit 1',
  ],
  maxRuntimeSeconds: 30,
  maxOutputBytes: 1024,
};

function attempt(command: string, inputValues: Record<string, unknown> = {}): ClaimedAttempt {
  return {
    attemptId: 'attempt123',
    leaseToken: 'lease',
    leaseExpiresAt: new Date().toISOString(),
    idempotencyKey: null,
    planDigest: null,
    executionId: 'execution123',
    inputValues,
    secretInputKeys: [],
    step: {
      key: 'shell',
      name: 'Shell',
      type: 'BASH',
      riskClass: 'READ_ONLY',
      config: { command },
      timeoutSeconds: 10,
    },
  };
}

describe('runbook Agent executor', () => {
  it('executes Bash-specific syntax with typed inputs', async () => {
    const result = await executeAttempt(
      attempt(
        'set -o pipefail; values=("$OPSKNIGHT_INPUT_ENV" ready); [[ "${values[0]}" == "prod" ]] && printf "%s" "${values[1]}"',
        { env: 'prod' }
      ),
      policy,
      new AbortController().signal
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', exitCode: 0, output: 'ready' });
  });

  it('honors Bash pipefail instead of accepting a failed pipeline', async () => {
    const result = await executeAttempt(
      attempt('set -o pipefail; false | true'),
      policy,
      new AbortController().signal
    );
    expect(result).toMatchObject({ status: 'FAILED', exitCode: 1, errorCode: 'COMMAND_FAILED' });
  });

  it('does not source inherited non-interactive Bash startup files', async () => {
    const result = await executeAttempt(
      attempt('[[ "$BASH_ENV" == /dev/null ]]'),
      policy,
      new AbortController().signal
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', exitCode: 0 });
  });

  it('passes typed inputs through the constrained environment', async () => {
    const result = await executeAttempt(
      attempt('printf "%s|%s" "$OPSKNIGHT_INPUT_SERVICE" "$OPSKNIGHT_INPUT_REPLICAS"', {
        service: 'payments',
        replicas: 3,
      }),
      policy,
      new AbortController().signal
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', exitCode: 0 });
    expect(result.output).toBe('payments|3');
  });

  it('receives a secret as environment data without inserting it into shell source', async () => {
    const command = 'test -n "$OPSKNIGHT_INPUT_TOKEN" && printf ready';
    const request = {
      ...attempt(command, { token: 'literal; $(exit 99) `exit 99`' }),
      secretInputKeys: ['token'],
    };
    const result = await executeAttempt(
      request,
      { ...policy, bashCommandPatterns: [command] },
      new AbortController().signal
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', exitCode: 0, output: 'ready' });
    expect(request.step.config.command).toBe(command);
  });

  it('bounds captured output and marks truncation', async () => {
    const result = await executeAttempt(
      attempt("printf 'x%.0s' {1..2000}"),
      { ...policy, maxOutputBytes: 1024 },
      new AbortController().signal
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1024);
    expect(result.output.endsWith('\n[output truncated]')).toBe(true);
    expect(result.output.startsWith('x'.repeat(1000))).toBe(true);
  });

  it('includes the marker inside the maximum 10 MiB output contract', async () => {
    const result = await executeAttempt(
      attempt('head -c 10485800 /dev/zero'),
      { ...policy, maxOutputBytes: 10 * 1024 * 1024 },
      new AbortController().signal
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(Buffer.byteLength(result.output)).toBe(10 * 1024 * 1024);
    expect(result.output.endsWith('\n[output truncated]')).toBe(true);
  });

  it('does not start work when cancellation is already requested', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executeAttempt(attempt('exit 99'), policy, controller.signal);
    expect(result).toMatchObject({ status: 'CANCELLED', errorCode: 'CANCELLED_BEFORE_START' });
  });

  it('terminates an active process group after cancellation', async () => {
    const controller = new AbortController();
    const execution = executeAttempt(attempt('sleep 30'), policy, controller.signal);
    setTimeout(() => controller.abort(), 50);
    const result = await execution;
    expect(result.status).toBe('CANCELLED');
  });

  it('treats a failed write command as ambiguous instead of retryable failure', async () => {
    const writeAttempt = attempt('exit 1');
    writeAttempt.step.riskClass = 'IDEMPOTENT_WRITE';
    const result = await executeAttempt(writeAttempt, policy, new AbortController().signal);
    expect(result).toMatchObject({ status: 'UNKNOWN', errorCode: 'COMMAND_FAILED' });
  });

  it('terminates active writes as UNKNOWN when local lease authority is lost', async () => {
    const controller = new AbortController();
    const write = attempt('sleep 30');
    write.step.riskClass = 'IDEMPOTENT_WRITE';
    const execution = executeAttempt(write, policy, controller.signal);
    setTimeout(() => controller.abort('LEASE_LOST'), 50);
    expect(await execution).toMatchObject({ status: 'UNKNOWN', errorCode: 'LEASE_LOST' });
  });

  it('slices Unicode text safely without splitting surrogate pairs or multibyte UTF-8 sequences', () => {
    // 4-byte emojis, 3-byte CJK, 2-byte Cyrillic
    const unicodeString = 'Logs: 🚨 Server failure! 日本語ログ Привет мир 🔥🔥🔥';
    const totalBytes = Buffer.byteLength(unicodeString, 'utf8');

    // Safe decoder with fatal: true throws on any malformed sequence
    const decoder = new TextDecoder('utf-8', { fatal: true });

    // Test slicing across various byte boundaries
    for (let targetBytes = 1; targetBytes <= totalBytes; targetBytes++) {
      const sliced = sliceUtf8Safe(unicodeString, targetBytes);
      const byteLength = Buffer.byteLength(sliced, 'utf8');
      expect(byteLength).toBeLessThanOrEqual(targetBytes);

      // Verify the sliced string encodes to completely valid UTF-8 without errors or replacement chars
      const encoded = Buffer.from(sliced, 'utf8');
      expect(() => decoder.decode(encoded)).not.toThrow();
      expect(sliced).not.toContain('\uFFFD');
    }

    // Full string preserved when limit exceeds byte length
    expect(sliceUtf8Safe(unicodeString, totalBytes + 100)).toBe(unicodeString);
  });

  it('correctly distinguishes healthy, starting, and unhealthy container states', () => {
    // Starting states
    expect(isContainerStarting('{"Health":{"Status":"starting"}}')).toBe(true);
    expect(isContainerStarting('{"Healthcheck":{"Status":"starting"}}')).toBe(true);
    expect(isContainerStarting('"starting"')).toBe(true);
    expect(isContainerStarting('{"status":"starting"}')).toBe(true);
    expect(isContainerStarting('{"Health":{"Status":"healthy"}}')).toBe(false);

    // Healthy states
    expect(containerHealthPassed('{"Health":{"Status":"healthy"}}')).toBe(true);
    expect(containerHealthPassed('{"Healthcheck":{"Status":"healthy"}}')).toBe(true);
    expect(containerHealthPassed('"healthy"')).toBe(true);
    expect(containerHealthPassed('{"status":"healthy"}')).toBe(true);
    expect(containerHealthPassed('{"Health":{"Status":"starting"}}')).toBe(false);
    expect(containerHealthPassed('{"Health":{"Status":"unhealthy"}}')).toBe(false);
    expect(containerHealthPassed('')).toBe(false);
    expect(containerHealthPassed('invalid-json')).toBe(false);
  });

  it('respects step.timeoutSeconds and abort signals during execution', async () => {
    const customAttempt: ClaimedAttempt = {
      attemptId: 'att-timeout',
      leaseToken: 'lease-tok',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-timeout',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'docker_health_check',
        name: 'Health check',
        type: 'DOCKER',
        riskClass: 'READ_ONLY',
        config: {
          action: 'health',
          container: 'api',
        },
        timeoutSeconds: 2,
      },
    };

    const dockerPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['DOCKER'],
      dockerContainers: ['api'],
    };

    const controller = new AbortController();
    controller.abort('AGENT_SHUTDOWN');
    const result = await executeAttempt(customAttempt, dockerPolicy, controller.signal);
    expect(result.status).toBe('CANCELLED');
    expect(result.errorCode).toBe('AGENT_INTERRUPTED_BY_SHUTDOWN');
  });

  it('polls container health transitioning from starting to healthy', async () => {
    let callCount = 0;
    const fakeRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 'SUCCEEDED' as const,
          output: '{"Health":{"Status":"starting"}}',
          exitCode: 0,
        };
      }
      return {
        status: 'SUCCEEDED' as const,
        output: '{"Health":{"Status":"healthy"}}',
        exitCode: 0,
      };
    };

    const attemptObj: ClaimedAttempt = {
      attemptId: 'att-health-poll-1',
      leaseToken: 'tok-1',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-1',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'health_poll',
        name: 'Poll health',
        type: 'DOCKER',
        riskClass: 'READ_ONLY',
        config: { action: 'health', container: 'api' },
        timeoutSeconds: 5,
      },
    };

    const dockerPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['DOCKER'],
      dockerContainers: ['api'],
    };
    const result = await executeAttempt(
      attemptObj,
      dockerPolicy,
      new AbortController().signal,
      fakeRunner
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(callCount).toBe(2);
    expect(result.output).toContain('"healthy"');
  });

  it('fails container health when it remains in starting beyond step timeout deadline', async () => {
    const fakeRunner = async () => ({
      status: 'SUCCEEDED' as const,
      output: '{"Health":{"Status":"starting"}}',
      exitCode: 0,
    });

    const attemptObj: ClaimedAttempt = {
      attemptId: 'att-health-poll-2',
      leaseToken: 'tok-2',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-2',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'health_poll_timeout',
        name: 'Poll health timeout',
        type: 'DOCKER',
        riskClass: 'READ_ONLY',
        config: { action: 'health', container: 'api' },
        timeoutSeconds: 1, // Short deadline: 1s
      },
    };

    const dockerPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['DOCKER'],
      dockerContainers: ['api'],
    };
    const startTime = Date.now();
    const result = await executeAttempt(
      attemptObj,
      dockerPolicy,
      new AbortController().signal,
      fakeRunner
    );
    const duration = Date.now() - startTime;

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('CONTAINER_UNHEALTHY');
    // Ensure timeout happened according to 1s step deadline and didn't wait for 5s artificial floor
    expect(duration).toBeLessThan(3000);
  });

  it('propagates retry failures that occur halfway through health polling', async () => {
    let callCount = 0;
    const fakeRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 'SUCCEEDED' as const,
          output: '{"Health":{"Status":"starting"}}',
          exitCode: 0,
        };
      }
      return {
        status: 'FAILED' as const,
        output: 'Cannot connect to the Docker daemon',
        exitCode: 1,
        errorCode: 'DOCKER_DAEMON_DOWN',
        errorMessage: 'Daemon connection lost',
      };
    };

    const attemptObj: ClaimedAttempt = {
      attemptId: 'att-health-poll-3',
      leaseToken: 'tok-3',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-3',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'health_poll_retry_fail',
        name: 'Poll health retry fail',
        type: 'DOCKER',
        riskClass: 'READ_ONLY',
        config: { action: 'health', container: 'api' },
        timeoutSeconds: 5,
      },
    };

    const dockerPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['DOCKER'],
      dockerContainers: ['api'],
    };
    const result = await executeAttempt(
      attemptObj,
      dockerPolicy,
      new AbortController().signal,
      fakeRunner
    );

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('DOCKER_DAEMON_DOWN');
    expect(result.errorMessage).toBe('Daemon connection lost');
  });

  it('transitions to UNKNOWN when local lease authority is lost during health polling', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const fakeRunner = async () => {
      callCount++;
      if (callCount === 1) {
        // Trigger authority expiration during polling wait
        setTimeout(() => controller.abort('LEASE_LOST'), 50);
        return {
          status: 'SUCCEEDED' as const,
          output: '{"Health":{"Status":"starting"}}',
          exitCode: 0,
        };
      }
      return {
        status: 'SUCCEEDED' as const,
        output: '{"Health":{"Status":"starting"}}',
        exitCode: 0,
      };
    };

    const attemptObj: ClaimedAttempt = {
      attemptId: 'att-health-poll-4',
      leaseToken: 'tok-4',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-4',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'health_poll_lease_lost',
        name: 'Poll health authority lost',
        type: 'DOCKER',
        riskClass: 'READ_ONLY',
        config: { action: 'health', container: 'api' },
        timeoutSeconds: 10,
      },
    };

    const dockerPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['DOCKER'],
      dockerContainers: ['api'],
    };
    const result = await executeAttempt(attemptObj, dockerPolicy, controller.signal, fakeRunner);

    expect(result.status).toBe('UNKNOWN');
    expect(result.errorCode).toBe('LEASE_LOST');
    expect(result.errorMessage).toContain('Local execution authority expired');
  });

  it('treats systemctl status exit code 3 (inactive/dead) as a successful status query', async () => {
    const fakeRunner = async () => ({
      status: 'SUCCEEDED' as const,
      output: '○ cert-sample.service - Inactive Service\n   Active: inactive (dead)',
      exitCode: 3,
    });

    const attemptObj: ClaimedAttempt = {
      attemptId: 'att-systemd-status-1',
      leaseToken: 'tok-sys-1',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-sys-1',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'pre_systemd_status',
        name: 'Precheck systemd status',
        type: 'SYSTEMD',
        riskClass: 'READ_ONLY',
        config: { action: 'status', unit: 'cert-sample.service' },
        timeoutSeconds: 10,
      },
    };

    const systemdPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['SYSTEMD'],
      systemdUnits: ['cert-sample.service'],
    };

    const result = await executeAttempt(
      attemptObj,
      systemdPolicy,
      new AbortController().signal,
      fakeRunner
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.exitCode).toBe(3);
    expect(result.errorCode).toBeUndefined();
  });

  it('treats non-zero exit code on systemctl restart as a failure', async () => {
    const fakeRunner = async () => ({
      status: 'UNKNOWN' as const,
      output: 'Failed to restart cert-sample.service: Unit not found.',
      exitCode: 5,
      errorCode: 'COMMAND_FAILED',
      errorMessage: 'Command exited with 5.',
    });

    const attemptObj: ClaimedAttempt = {
      attemptId: 'att-systemd-restart-1',
      leaseToken: 'tok-sys-2',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-sys-2',
      inputValues: {},
      secretInputKeys: [],
      step: {
        key: 'systemd_service_restart',
        name: 'Restart cert-sample.service',
        type: 'SYSTEMD',
        riskClass: 'NON_IDEMPOTENT',
        config: { action: 'restart', unit: 'cert-sample.service' },
        timeoutSeconds: 10,
      },
    };

    const systemdPolicy: AgentPolicy = {
      ...policy,
      allowedStepTypes: ['SYSTEMD'],
      allowNonIdempotent: true,
      systemdUnits: ['cert-sample.service'],
    };

    const result = await executeAttempt(
      attemptObj,
      systemdPolicy,
      new AbortController().signal,
      fakeRunner
    );

    expect(result.status).toBe('UNKNOWN');
    expect(result.exitCode).toBe(5);
    expect(result.errorCode).toBe('COMMAND_FAILED');
  });
});
