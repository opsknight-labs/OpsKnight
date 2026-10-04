import { lookup } from 'node:dns/promises';
import { createConnection } from 'node:net';
import type { AgentPolicy, ClaimedAttempt } from './types';
import { assertPolicyAllows } from './policy';
import type { ExecutionResult } from './executor';

export async function executeNetworkDiagnostic(
  attempt: ClaimedAttempt,
  policy: AgentPolicy,
  signal: AbortSignal
): Promise<ExecutionResult> {
  assertPolicyAllows(attempt, policy);
  const config = attempt.step.config;
  const timeout = Math.min(30, policy.maxRuntimeSeconds, attempt.step.timeoutSeconds ?? 5) * 1000;
  const authority = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  try {
    authority.throwIfAborted();
    let evidence: unknown;
    if (config.diagnostic === 'dns') {
      // DNS cannot cancel an OS lookup, but the bounded race never retains execution authority.
      let onAbort: (() => void) | undefined;
      try {
        evidence = await Promise.race([
          lookup(String(config.hostname), { all: true }).then(result => result.slice(0, 32)),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error('DNS diagnostic cancelled or timed out.'));
            authority.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } finally {
        if (onAbort) authority.removeEventListener('abort', onAbort);
      }
    } else if (config.diagnostic === 'tcp') {
      evidence = await new Promise(resolve => {
        const socket = createConnection({
          host: String(config.host),
          port: Number(config.port),
          signal: authority,
        });
        socket.once('connect', () => {
          socket.destroy();
          resolve({ listening: true });
        });
        socket.once('error', error => {
          socket.destroy();
          resolve({ listening: false, error: error.message });
        });
      });
      if (!(evidence as { listening: boolean }).listening)
        throw new Error('TCP connection failed.');
    } else {
      const response = await fetch(String(config.url), { signal: authority, redirect: 'error' });
      await response.body?.cancel();
      evidence = { status: response.status, expectedStatus: Number(config.expectedStatus ?? 200) };
      if (response.status !== Number(config.expectedStatus ?? 200))
        throw new Error(`Health check returned HTTP ${response.status}.`);
    }
    const postState =
      config.diagnostic === 'http'
        ? {
            capturedAt: new Date().toISOString(),
            healthChecks: [
              {
                url: String(config.url),
                status: Number((evidence as { status: number }).status),
                healthy:
                  Number((evidence as { status: number }).status) >= 200 &&
                  Number((evidence as { status: number }).status) < 400,
              },
            ],
          }
        : config.diagnostic === 'tcp'
          ? {
              capturedAt: new Date().toISOString(),
              ports: [{ port: Number(config.port), listening: true }],
            }
          : undefined;
    return {
      status: 'SUCCEEDED',
      postState,
      exitCode: 0,
      output: JSON.stringify(evidence).slice(0, policy.maxOutputBytes),
    };
  } catch (error) {
    return {
      status: signal.aborted ? 'CANCELLED' : 'FAILED',
      output: '',
      errorCode: 'DIAGNOSTIC_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Network diagnostic failed.',
    };
  }
}
