import { describe, expect, it } from 'vitest';
import { executeAttempt } from '../../../agent/src/executor';
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

  it('bounds captured output and marks truncation', async () => {
    const result = await executeAttempt(
      attempt("printf '0123456789'"),
      { ...policy, maxOutputBytes: 5 },
      new AbortController().signal
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.output).toBe('01234\n[output truncated]');
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
});
