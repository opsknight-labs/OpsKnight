#!/usr/bin/env node
// Identity and policy paths come only from the local operator's environment, never API input.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentApiError, AgentClient, enrollAgent } from './client';
import { LeaseAuthority } from './lease';
import { verifyExecutionEnvelope, parseTrustedSigningKeys } from './envelope';
import { executeAttempt, sliceUtf8Safe } from './executor';
import { probeCapabilities } from './capabilities';
import { assertPolicyAllows, loadPolicy } from './policy';
import { ResultSpool } from './spool';
import { getAgentVersion } from './version';
import {
  computeReportedLastError,
  determineActiveBlockingCondition,
  isTransientCommunicationError,
  type SafetyLimits,
} from './recovery';
import type { AgentIdentity, ClaimedAttempt, SpoolRecord } from './types';

const baseUrl = process.env.OPSKNIGHT_URL?.trim();
const dataDirectory = process.env.OPSKNIGHT_AGENT_DATA_DIR ?? '/var/lib/opsknight-agent';
const identityPath = process.env.OPSKNIGHT_AGENT_IDENTITY_FILE ?? `${dataDirectory}/identity.json`;
const policyPath = process.env.OPSKNIGHT_AGENT_POLICY_FILE ?? '/etc/opsknight-agent/policy.json';
const executionPublicKey = (() => {
  try {
    return parseTrustedSigningKeys(
      process.env.OPSKNIGHT_EXECUTION_PUBLIC_KEYS,
      process.env.OPSKNIGHT_EXECUTION_PUBLIC_KEY
    );
  } catch {
    return null;
  }
})();

function parseBoundedInteger(
  envName: string,
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Invalid ${envName}: must be an integer between ${min} and ${max}, got "${raw}".`
    );
  }
  return parsed;
}

const MAX_SPOOL_RECORDS = parseBoundedInteger(
  'OPSKNIGHT_MAX_SPOOL_RECORDS',
  process.env.OPSKNIGHT_MAX_SPOOL_RECORDS,
  100,
  1,
  100_000
);
const MAX_SPOOL_BYTES = parseBoundedInteger(
  'OPSKNIGHT_MAX_SPOOL_BYTES',
  process.env.OPSKNIGHT_MAX_SPOOL_BYTES,
  50 * 1024 * 1024,
  1024 * 1024,
  10 * 1024 * 1024 * 1024
);
const MAX_SPOOL_RECORD_AGE_MS = parseBoundedInteger(
  'OPSKNIGHT_MAX_SPOOL_RECORD_AGE_MS',
  process.env.OPSKNIGHT_MAX_SPOOL_RECORD_AGE_MS,
  24 * 60 * 60 * 1000,
  60 * 1000,
  30 * 24 * 60 * 60 * 1000
);
const MAX_DEAD_LETTER_RECORDS = parseBoundedInteger(
  'OPSKNIGHT_MAX_DEAD_LETTER_RECORDS',
  process.env.OPSKNIGHT_MAX_DEAD_LETTER_RECORDS,
  50,
  1,
  50_000
);
const MAX_DEAD_LETTER_BYTES = parseBoundedInteger(
  'OPSKNIGHT_MAX_DEAD_LETTER_BYTES',
  process.env.OPSKNIGHT_MAX_DEAD_LETTER_BYTES,
  25 * 1024 * 1024,
  1024 * 1024,
  5 * 1024 * 1024 * 1024
);
const MAX_DEAD_LETTER_AGE_MS = parseBoundedInteger(
  'OPSKNIGHT_MAX_DEAD_LETTER_AGE_MS',
  process.env.OPSKNIGHT_MAX_DEAD_LETTER_AGE_MS,
  7 * 24 * 60 * 60 * 1000,
  60 * 1000,
  30 * 24 * 60 * 60 * 1000
);

async function saveIdentity(identity: AgentIdentity, targetPath = identityPath) {
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  await rename(temporary, targetPath);
}

async function loadIdentity(
  targetPath = identityPath,
  effectiveUrl = baseUrl
): Promise<AgentIdentity> {
  try {
    return JSON.parse(await readFile(targetPath, 'utf8')) as AgentIdentity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const tokenFile = process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE?.trim();
    const token = tokenFile
      ? (await readFile(tokenFile, 'utf8')).trim()
      : process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN?.trim();
    if (!token)
      throw new Error('Agent is not enrolled and OPSKNIGHT_AGENT_ENROLLMENT_TOKEN is missing.');
    if (!effectiveUrl) throw new Error('OPSKNIGHT_URL is required to enroll agent.');
    const identity = await enrollAgent(effectiveUrl, token);
    await saveIdentity(identity, targetPath);
    return identity;
  }
}

async function uploadOutput(
  client: AgentClient,
  attempt: Pick<ClaimedAttempt, 'attemptId' | 'leaseToken'>,
  output: string
): Promise<string | undefined> {
  if (Buffer.byteLength(output) <= 32_768) return undefined;
  const text = output;
  let content = gzipSync(Buffer.from(text, 'utf8'));
  let truncated = text.endsWith('[output truncated]');
  const MAX_ARTIFACT_SIZE = 10 * 1024 * 1024;
  if (content.length > MAX_ARTIFACT_SIZE) {
    const targetRatio = (9.5 * 1024 * 1024) / content.length;
    let maxBytes = Math.floor(Buffer.byteLength(text, 'utf8') * targetRatio);
    while (maxBytes > 0) {
      const sliced = sliceUtf8Safe(text, maxBytes);
      const withMarker = `${sliced}\n[output truncated]`;
      const compressed = gzipSync(Buffer.from(withMarker, 'utf8'));
      if (compressed.length <= MAX_ARTIFACT_SIZE) {
        content = compressed;
        truncated = true;
        break;
      }
      maxBytes = Math.floor(maxBytes * 0.9);
    }
    if (content.length > MAX_ARTIFACT_SIZE) return undefined;
  }
  const artifact = await client.uploadArtifact({
    attemptId: attempt.attemptId,
    leaseToken: attempt.leaseToken,
    kind: 'OUTPUT',
    mediaType: 'text/plain; charset=utf-8',
    encoding: 'gzip',
    contentBase64: content.toString('base64'),
    sha256: createHash('sha256').update(content).digest('hex'),
    truncated,
  });
  return artifact?.id;
}

function redactSecretInputs(attempt: ClaimedAttempt, output: string): string {
  const secretValues = attempt.secretInputKeys
    .map(key => Object.entries(attempt.inputValues).find(([name]) => name === key)?.[1])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length);
  return secretValues.reduce((redacted, value) => redacted.split(value).join('[REDACTED]'), output);
}

function redactEvidence(
  attempt: ClaimedAttempt,
  state: Record<string, unknown>
): Record<string, unknown> {
  const visit = (value: unknown, field = ''): unknown =>
    typeof value === 'string'
      ? redactSecretInputs(attempt, value).slice(
          0,
          field === 'serviceState'
            ? 100
            : field === 'captureError'
              ? 200
              : field === 'url'
                ? 2048
                : 4096
        )
      : Array.isArray(value)
        ? value.map(item => visit(item, field))
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value).map(([key, nested]) => [key, visit(nested, key)])
            )
          : value;
  return visit(state) as Record<string, unknown>;
}

export interface RunAgentOptions {
  baseUrl?: string;
  dataDirectory?: string;
  identityPath?: string;
  identity?: AgentIdentity;
  policyPath?: string;
  policy?: import('./types').AgentPolicy;
  policyHash?: string;
  executionPublicKey?: string | Record<string, string>;
  signal?: AbortSignal;
  maxIterations?: number;
  client?: AgentClient;
  spool?: ResultSpool;
  pollIntervalMs?: number;
  skipHeartbeat?: boolean;
  skipHealth?: boolean;
}

export async function run(options: RunAgentOptions = {}) {
  const effectiveBaseUrl = options.baseUrl ?? baseUrl;
  const effectiveDataDir = options.dataDirectory ?? dataDirectory;
  const effectiveIdentityPath = options.identityPath ?? identityPath;
  const effectivePolicyPath = options.policyPath ?? policyPath;
  const effectiveKey = options.executionPublicKey ?? executionPublicKey;
  const pollInterval = options.pollIntervalMs ?? 2_000;

  if (!effectiveBaseUrl) throw new Error('OPSKNIGHT_URL is required.');
  if (!effectiveKey)
    throw new Error(
      'Pin OPSKNIGHT_EXECUTION_PUBLIC_KEY from Runbooks > Agents before starting the Agent.'
    );

  const identity =
    options.identity ?? (await loadIdentity(effectiveIdentityPath, effectiveBaseUrl));
  const { policy, hash: policyHash } =
    options.policy !== undefined
      ? { policy: options.policy, hash: options.policyHash ?? 'mock-policy-hash' }
      : await loadPolicy(effectivePolicyPath);
  const client = options.client ?? new AgentClient(effectiveBaseUrl, identity, effectiveKey);
  const spool = options.spool ?? new ResultSpool(`${effectiveDataDir}/spool`);
  await spool.initialize();
  let active = 0;
  let transientCommunicationError: string | null = null;
  let terminalAuthError: string | null = null;
  let storageError: string | null = null;
  let lastClaimError: string | null = null;
  let inFlightError: string | null = null;
  let shuttingDown = false;
  let activeController: AbortController | null = null;
  const abortUnfinishedExecution = () => activeController?.abort('LEASE_LOST');

  const drainFilePath = `${effectiveDataDir}/drain`;
  const drainReadyFilePath = `${effectiveDataDir}/drain-ready`;

  const checkDraining = async (): Promise<boolean> => {
    try {
      await access(drainFilePath);
      return true;
    } catch {
      return false;
    }
  };

  const safetyLimits: SafetyLimits = {
    maxSpoolRecords: MAX_SPOOL_RECORDS,
    maxSpoolBytes: MAX_SPOOL_BYTES,
    maxSpoolRecordAgeMs: MAX_SPOOL_RECORD_AGE_MS,
    maxDeadLetterRecords: MAX_DEAD_LETTER_RECORDS,
    maxDeadLetterBytes: MAX_DEAD_LETTER_BYTES,
    maxDeadLetterAgeMs: MAX_DEAD_LETTER_AGE_MS,
  };

  let clockError: string | null = null;
  let lastClockCheck = 0;
  let cachedClockSkew: number | null = null;

  const checkStorageHealth = async (): Promise<boolean> => {
    try {
      await spool.probeStorageIntegrity();
      storageError = null;
      return true;
    } catch (fsErr) {
      storageError = fsErr instanceof Error ? fsErr.message : String(fsErr);
      return false;
    }
  };

  const getActiveBlockingCondition = async (): Promise<string | null> => {
    if (storageError) {
      const recovered = await checkStorageHealth();
      if (!recovered) {
        return `Execution claims paused due to local storage failure: ${storageError}`;
      }
    }
    const isDraining = await checkDraining();
    try {
      const deadLetterStats = await spool.deadLetterStats();
      const spoolStats = await spool.stats();
      return determineActiveBlockingCondition({
        storageError: null,
        clockError,
        deadLetterStats,
        spoolStats,
        isDraining,
        limits: safetyLimits,
      });
    } catch (fsErr) {
      storageError = fsErr instanceof Error ? fsErr.message : String(fsErr);
      return `Execution claims paused due to local storage failure: ${storageError}`;
    }
  };

  const getEffectiveLastError = async (): Promise<string | null> => {
    const activeBlockingError = await getActiveBlockingCondition();
    return computeReportedLastError({
      activeBlockingError,
      terminalAuthError,
      operationalError: storageError ?? lastClaimError,
      inFlightError,
      transientError: transientCommunicationError,
    });
  };

  const flushSpool = async () => {
    let submitFailed = false;
    let submittedCount = 0;
    try {
      const records = await spool.list();
      if (storageError) {
        await checkStorageHealth();
      }
      for (const record of records) {
        try {
          const { localOutput, ...result } = record;
          if (localOutput && !result.outputArtifactId) {
            const artifactId = await uploadOutput(client, record, localOutput);
            if (artifactId) {
              result.outputArtifactId = artifactId;
              await spool.put({ ...record, outputArtifactId: artifactId });
            }
          }
          await client.submit(result);
          await spool.remove(record.attemptId);
          submittedCount += 1;
        } catch (error) {
          submitFailed = true;
          transientCommunicationError = error instanceof Error ? error.message : String(error);
          if (error instanceof AgentApiError && error.terminal) {
            await spool.quarantine(record.attemptId);
            process.stderr.write(`Result ${record.attemptId} quarantined: HTTP ${error.status}\n`);
            continue;
          }
          break;
        }
      }
      // Only clear communication error if we actually submitted records and fully drained the spool
      if (!submitFailed && submittedCount > 0 && (await spool.depth()) === 0) {
        transientCommunicationError = null;
      }
    } catch (fsErr) {
      storageError = `Spool storage inaccessible: ${fsErr instanceof Error ? fsErr.message : String(fsErr)}`;
      process.stderr.write(`[Agent Storage Error] ${storageError}\n`);
    }
  };

  const checkClock = async (force = false): Promise<number | null> => {
    const now = Date.now();
    if (!force && lastClockCheck > 0 && now - lastClockCheck < 30_000) {
      return cachedClockSkew;
    }
    try {
      const { skewSeconds } = await client.checkServerClock();
      lastClockCheck = now;
      cachedClockSkew = skewSeconds;
      if (skewSeconds > 60) {
        clockError = `Agent clock differs from OpsKnight by ${skewSeconds}s. Execution claims paused until clock is synchronized.`;
      } else {
        clockError = null; // Clear immediately when clock becomes healthy
      }
    } catch {
      if (lastClockCheck === 0 || cachedClockSkew === null) {
        clockError =
          'Initial clock synchronization check with control plane failed. Execution claims paused.';
      }
    }
    return cachedClockSkew;
  };

  const heartbeat = async () => {
    await checkClock(false);
    const effective = await probeCapabilities(policy);
    let spoolDepth = 0;
    let deadLetterDepth = 0;
    try {
      spoolDepth = await spool.depth();
      deadLetterDepth = await spool.deadLetterDepth();
      if (storageError) {
        await checkStorageHealth();
      }
    } catch (spoolErr) {
      storageError = spoolErr instanceof Error ? spoolErr.message : String(spoolErr);
      process.stderr.write(`[Agent Storage Error] ${storageError}\n`);
    }
    const lastError = await getEffectiveLastError();
    await client.heartbeat({
      capabilities: effective.capabilities,
      capabilityReport: effective.report,
      trustedSigningKeys:
        typeof effectiveKey === 'object' ? Object.keys(effectiveKey) : ['default'],
      policyHash,
      spoolDepth,
      deadLetterDepth,
      activeAttemptCount: active,
      lastError,
    });
    // Demonstrated heartbeat roundtrip clears transient communication and auth errors.
    transientCommunicationError = null;
    terminalAuthError = null;
  };

  let publishingHealth = false;
  const publishHealth = async () => {
    if (publishingHealth) return;
    publishingHealth = true;
    try {
      const draining = await checkDraining();
      await mkdir(effectiveDataDir, { recursive: true, mode: 0o700 });
      const temporary = `${effectiveDataDir}/health.${process.pid}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          pid: process.pid,
          updatedAt: Date.now(),
          ready: !draining && clockError === null && storageError === null,
          draining,
          activeAttemptCount: active,
          version: getAgentVersion(),
          storageError,
          lastClaimError,
        }),
        { mode: 0o600 }
      );
      await rename(temporary, `${effectiveDataDir}/health.json`);
      if (storageError?.startsWith('Agent data directory inaccessible')) {
        storageError = null;
      }
    } catch (healthErr) {
      storageError = `Agent data directory inaccessible: ${healthErr instanceof Error ? healthErr.message : String(healthErr)}`;
    } finally {
      publishingHealth = false;
    }
  };

  if (!options.skipHealth) {
    await publishHealth();
  }
  if (!options.skipHeartbeat) {
    await heartbeat();
  }

  const heartbeatTimer = options.skipHeartbeat
    ? null
    : setInterval(() => void heartbeat().catch(() => undefined), 30_000);
  const healthTimer = options.skipHealth
    ? null
    : setInterval(() => void publishHealth().catch(() => undefined), 15_000);

  const shutdown = () => {
    shuttingDown = true;
    activeController?.abort('AGENT_SHUTDOWN');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (healthTimer) clearInterval(healthTimer);
    process.exitCode = 0;
  };
  if (options.signal) {
    if (options.signal.aborted) {
      shutdown();
      return;
    }
    options.signal.addEventListener('abort', shutdown, { once: true });
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  let iterationsRun = 0;
  try {
    while (!shuttingDown) {
      if (options.maxIterations !== undefined) {
        if (iterationsRun >= options.maxIterations) {
          break;
        }
        iterationsRun++;
      }
      await flushSpool();
      const draining = await checkDraining();
      if (draining) {
        if (active === 0) {
          try {
            await writeFile(
              drainReadyFilePath,
              JSON.stringify({ draining: true, at: Date.now(), activeAttempts: 0 }),
              { mode: 0o600 }
            );
          } catch {
            // State directory write
          }
        }
        await publishHealth();
        await new Promise(resolve => setTimeout(resolve, Math.min(1_000, pollInterval)));
        continue;
      }
      let attempt: ClaimedAttempt | null = null;
      let started = false;
      let renewTimer: NodeJS.Timeout | null = null;
      let authority: LeaseAuthority | null = null;
      let resultPersisted = false;
      let outcomeKnown = false;
      try {
        const activeCondition = await getActiveBlockingCondition();
        if (activeCondition) {
          await new Promise(resolve => setTimeout(resolve, Math.min(5_000, pollInterval)));
          continue;
        }

        const currentSpoolDepth = await spool.depth();
        const currentDeadLetterDepth = await spool.deadLetterDepth();

        const readOnlyOnly = currentSpoolDepth > 0 || currentDeadLetterDepth > 0;
        try {
          attempt = await client.claim({ readOnlyOnly });
          // A successful claim request (even if no attempt available) proves connectivity & valid auth
          transientCommunicationError = null;
          terminalAuthError = null;
          lastClaimError = null;
        } catch (claimErr) {
          if (claimErr instanceof AgentApiError) {
            if (claimErr.status === 401 || claimErr.status === 403) {
              terminalAuthError = `Agent authentication revoked or invalid: HTTP ${claimErr.status} - ${claimErr.message}`;
              transientCommunicationError = null;
              await new Promise(resolve => setTimeout(resolve, Math.min(15_000, pollInterval * 3)));
              continue;
            }
            if (claimErr.status === 429) {
              transientCommunicationError = `Agent API rate limit exceeded: HTTP 429 - ${claimErr.message}`;
              await new Promise(resolve => setTimeout(resolve, Math.min(10_000, pollInterval * 2)));
              continue;
            }
            if (claimErr.status === 409) {
              lastClaimError = `Agent claim conflict: HTTP 409 - ${claimErr.message}`;
              await new Promise(resolve => setTimeout(resolve, pollInterval));
              continue;
            }
            if (claimErr.status >= 500) {
              transientCommunicationError = `Agent API server error: HTTP ${claimErr.status} - ${claimErr.message}`;
              await new Promise(resolve => setTimeout(resolve, Math.min(5_000, pollInterval)));
              continue;
            }
            lastClaimError = `Agent API claim rejected: HTTP ${claimErr.status} - ${claimErr.message}`;
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            continue;
          }
          const claimMessage = claimErr instanceof Error ? claimErr.message : String(claimErr);
          if (isTransientCommunicationError(claimMessage)) {
            transientCommunicationError = claimMessage;
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          } else {
            lastClaimError = `Unexpected claim failure: ${claimMessage}`;
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
          continue;
        }
        if (!attempt) {
          continue;
        }
        if (await checkDraining()) {
          await client.releaseClaim(attempt.attemptId, attempt.leaseToken).catch(() => undefined);
          continue;
        }
        if (readOnlyOnly && attempt.step.riskClass !== 'READ_ONLY') {
          await client.releaseClaim(attempt.attemptId, attempt.leaseToken).catch(() => undefined);
          continue;
        }
        verifyExecutionEnvelope(attempt, effectiveKey!, identity.agentId);
        if (
          attempt.secretInputKeys.length > 0 &&
          new URL(effectiveBaseUrl).protocol !== 'https:' &&
          !(
            (process.env.NODE_ENV === 'development' &&
              process.env.OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS === 'true') ||
            process.env.OPSKNIGHT_ALLOW_INSECURE_HTTP === 'true'
          )
        ) {
          throw new Error('Secret-backed execution requires an HTTPS control-plane URL.');
        }
        let startResult: Awaited<ReturnType<AgentClient['start']>> | null = null;
        for (let retry = 0; retry < 3; retry++) {
          try {
            startResult = await client.start(attempt.attemptId, attempt.leaseToken);
            break;
          } catch (error) {
            if (error instanceof AgentApiError || retry === 2) throw error;
          }
        }
        if (!startResult) throw new Error('Missing start acknowledgement.');
        started = true;
        assertPolicyAllows(attempt, policy);
        if (!(await spool.markStarted(attempt.attemptId))) {
          continue;
        }
        active += 1;
        const controller = new AbortController();
        activeController = controller;
        authority = new LeaseAuthority(controller);
        authority.renew(startResult.leaseExpiresAt, attempt.executionDeadlineAt);
        let renewing = false;
        renewTimer = setInterval(() => {
          if (renewing || !authority?.valid) return;
          renewing = true;
          void client
            .renew(attempt!.attemptId, attempt!.leaseToken)
            .then(result => {
              if (result?.cancelRequested) controller.abort('CANCEL_REQUESTED');
              else if (result && authority?.valid) {
                authority.renew(result.leaseExpiresAt, attempt!.executionDeadlineAt);
                inFlightError = null;
              }
            })
            .catch(error => {
              inFlightError = 'Execution lease renewal failed.';
              if (
                error instanceof AgentApiError &&
                [401, 403, 404, 409, 410].includes(error.status)
              )
                controller.abort('LEASE_LOST');
            })
            .finally(() => {
              renewing = false;
            });
        }, 10_000);
        const result = await executeAttempt(attempt, policy, controller.signal);
        outcomeKnown = true;
        const producedAt = new Date().toISOString();
        clearInterval(renewTimer);
        renewTimer = null;
        authority.dispose();
        activeController = null;
        active -= 1;
        inFlightError = null;
        const redactedOutput = redactSecretInputs(attempt, result.output);
        const record: SpoolRecord = {
          attemptId: attempt.attemptId,
          leaseToken: attempt.leaseToken,
          producedAt,
          status: result.status,
          preState: result.preState ? redactEvidence(attempt, result.preState) : undefined,
          postState: result.postState ? redactEvidence(attempt, result.postState) : undefined,
          exitCode: result.exitCode,
          outputPreview: redactedOutput.slice(0, 32_768),
          localOutput: redactedOutput,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage
            ? redactSecretInputs(attempt, result.errorMessage)
            : undefined,
        };
        await spool.put(record);
        resultPersisted = true;
        await flushSpool();
      } catch (error) {
        if (renewTimer) clearInterval(renewTimer);
        authority?.dispose();
        active = 0;
        inFlightError = null;
        activeController = null;
        const failureMessage = error instanceof Error ? error.message : String(error);
        if (isTransientCommunicationError(failureMessage)) {
          transientCommunicationError = failureMessage;
        } else if (
          error instanceof AgentApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          terminalAuthError = `Agent authentication revoked or invalid: HTTP ${error.status} - ${error.message}`;
        }
        // Stop accepting work only if a known outcome cannot reach durable storage.
        if (outcomeKnown && !resultPersisted) {
          storageError = `Outcome could not be persisted to durable spool: ${failureMessage}`;
          throw error;
        }
        if (attempt && started && !resultPersisted) {
          const isWrite = attempt.step.riskClass !== 'READ_ONLY';
          try {
            await spool.put({
              attemptId: attempt.attemptId,
              leaseToken: attempt.leaseToken,
              producedAt: new Date().toISOString(),
              status: shuttingDown
                ? isWrite
                  ? 'UNKNOWN'
                  : 'CANCELLED'
                : failureMessage.startsWith('LOCAL_POLICY_DENIED')
                  ? 'FAILED'
                  : 'UNKNOWN',
              errorCode: shuttingDown
                ? isWrite
                  ? 'AGENT_INTERRUPTED_BY_SHUTDOWN'
                  : 'AGENT_SHUTDOWN'
                : failureMessage.startsWith('LOCAL_POLICY_DENIED')
                  ? 'LOCAL_POLICY_DENIED'
                  : 'AGENT_FAILURE',
              errorMessage: shuttingDown
                ? isWrite
                  ? 'Execution was interrupted by process shutdown; target state is unknown.'
                  : 'Execution was cancelled by process shutdown.'
                : redactSecretInputs(attempt, failureMessage),
            });
            resultPersisted = true;
          } catch (spoolErr) {
            storageError = `Failed to persist execution outcome: ${spoolErr instanceof Error ? spoolErr.message : String(spoolErr)}`;
            throw spoolErr;
          }
        }
        if (shuttingDown) {
          await flushSpool().catch(() => undefined);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (healthTimer) clearInterval(healthTimer);
    abortUnfinishedExecution();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}

const isDirectExecution = () => {
  if (typeof process === 'undefined' || !process.argv || !process.argv[1]) return false;
  try {
    const executed = process.argv[1];
    return (
      executed.endsWith('opsknight-agent.mjs') ||
      executed.endsWith('agent/src/index.ts') ||
      Boolean(import.meta.url && fileURLToPath(import.meta.url) === executed)
    );
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  void run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
