#!/usr/bin/env node
// Identity and policy paths come only from the local operator's environment, never API input.
/* eslint-disable security/detect-non-literal-fs-filename */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AgentApiError, AgentClient, enrollAgent } from './client';
import { LeaseAuthority } from './lease';
import { verifyExecutionEnvelope, parseTrustedSigningKeys } from './envelope';
import { executeAttempt } from './executor';
import { probeCapabilities } from './capabilities';
import { assertPolicyAllows, loadPolicy } from './policy';
import { ResultSpool } from './spool';
import type { AgentIdentity, ClaimedAttempt, SpoolRecord } from './types';

const baseUrl = process.env.OPSKNIGHT_URL?.trim();
const dataDirectory = process.env.OPSKNIGHT_AGENT_DATA_DIR ?? '/var/lib/opsknight-agent';
const identityPath = process.env.OPSKNIGHT_AGENT_IDENTITY_FILE ?? `${dataDirectory}/identity.json`;
const policyPath = process.env.OPSKNIGHT_AGENT_POLICY_FILE ?? '/etc/opsknight-agent/policy.json';
const executionPublicKey = parseTrustedSigningKeys(
  process.env.OPSKNIGHT_EXECUTION_PUBLIC_KEYS,
  process.env.OPSKNIGHT_EXECUTION_PUBLIC_KEY
);

if (!baseUrl) throw new Error('OPSKNIGHT_URL is required.');
if (!executionPublicKey)
  throw new Error(
    'Pin OPSKNIGHT_EXECUTION_PUBLIC_KEY from Runbooks > Agents before starting the Agent.'
  );

async function saveIdentity(identity: AgentIdentity) {
  await mkdir(dirname(identityPath), { recursive: true, mode: 0o700 });
  const temporary = `${identityPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  await rename(temporary, identityPath);
}

async function loadIdentity(): Promise<AgentIdentity> {
  try {
    return JSON.parse(await readFile(identityPath, 'utf8')) as AgentIdentity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const tokenFile = process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE?.trim();
    const token = tokenFile
      ? (await readFile(tokenFile, 'utf8')).trim()
      : process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN?.trim();
    if (!token)
      throw new Error('Agent is not enrolled and OPSKNIGHT_AGENT_ENROLLMENT_TOKEN is missing.');
    const identity = await enrollAgent(baseUrl!, token);
    await saveIdentity(identity);
    return identity;
  }
}

async function uploadOutput(
  client: AgentClient,
  attempt: Pick<ClaimedAttempt, 'attemptId' | 'leaseToken'>,
  output: string
): Promise<string | undefined> {
  if (Buffer.byteLength(output) <= 32_768) return undefined;
  const content = gzipSync(Buffer.from(output));
  if (content.length > 1_048_576) return undefined;
  const artifact = await client.uploadArtifact({
    attemptId: attempt.attemptId,
    leaseToken: attempt.leaseToken,
    kind: 'OUTPUT',
    mediaType: 'text/plain; charset=utf-8',
    encoding: 'gzip',
    contentBase64: content.toString('base64'),
    sha256: createHash('sha256').update(content).digest('hex'),
    truncated: output.endsWith('[output truncated]'),
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

async function run() {
  const identity = await loadIdentity();
  const { policy, hash: policyHash } = await loadPolicy(policyPath);
  const client = new AgentClient(baseUrl!, identity, executionPublicKey);
  const spool = new ResultSpool(`${dataDirectory}/spool`);
  await spool.initialize();
  let active = 0;
  let lastError: string | null = null;
  let shuttingDown = false;
  let activeController: AbortController | null = null;
  const abortUnfinishedExecution = () => activeController?.abort('LEASE_LOST');

  const flushSpool = async () => {
    for (const record of await spool.list()) {
      try {
        const { localOutput, ...result } = record;
        if (localOutput && !result.outputArtifactId) {
          result.outputArtifactId = await uploadOutput(client, record, localOutput).catch(
            () => undefined
          );
          if (result.outputArtifactId)
            await spool.put({ ...record, outputArtifactId: result.outputArtifactId });
        }
        await client.submit(result);
        await spool.remove(record.attemptId);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (error instanceof AgentApiError && error.terminal) {
          await spool.quarantine(record.attemptId);
          process.stderr.write(`Result ${record.attemptId} quarantined: HTTP ${error.status}\n`);
          continue;
        }
        break;
      }
    }
  };

  let clockError: string | null = null;
  let lastClockCheck = 0;
  let cachedClockSkew = 0;

  const checkClock = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastClockCheck < 30_000) {
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
      // Retain last known state on transient error
    }
    return cachedClockSkew;
  };

  const heartbeat = async () => {
    await checkClock(false);
    const effective = await probeCapabilities(policy);
    await client.heartbeat({
      capabilities: effective.capabilities,
      capabilityReport: effective.report,
      trustedSigningKeys:
        typeof executionPublicKey === 'object' ? Object.keys(executionPublicKey) : ['default'],
      policyHash,
      spoolDepth: await spool.depth(),
      deadLetterDepth: await spool.deadLetterDepth(),
      activeAttemptCount: active,
      lastError: clockError || lastError,
    });
  };
  await heartbeat();
  let publishingHealth = false;
  const publishHealth = async () => {
    if (publishingHealth) return;
    publishingHealth = true;
    try {
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
      const temporary = `${dataDirectory}/health.${process.pid}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ pid: process.pid, updatedAt: Date.now(), ready: true }),
        { mode: 0o600 }
      );
      await rename(temporary, `${dataDirectory}/health.json`);
    } finally {
      publishingHealth = false;
    }
  };
  await publishHealth();
  const heartbeatTimer = setInterval(() => void heartbeat().catch(() => undefined), 30_000);
  const healthTimer = setInterval(() => void publishHealth().catch(() => undefined), 15_000);

  const shutdown = () => {
    shuttingDown = true;
    activeController?.abort();
    clearInterval(heartbeatTimer);
    clearInterval(healthTimer);
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    while (!shuttingDown) {
      await flushSpool();
      let attempt: ClaimedAttempt | null = null;
      let started = false;
      let renewTimer: NodeJS.Timeout | null = null;
      let authority: LeaseAuthority | null = null;
      let resultPersisted = false;
      let outcomeKnown = false;
      try {
        const skew = await checkClock(false);
        if (skew > 60) {
          await new Promise(resolve => setTimeout(resolve, 10_000));
          continue;
        }
        attempt = await client.claim();
        if (!attempt) continue;
        verifyExecutionEnvelope(attempt, executionPublicKey!, identity.agentId);
        if (
          attempt.secretInputKeys.length > 0 &&
          new URL(baseUrl!).protocol !== 'https:' &&
          !(
            process.env.NODE_ENV === 'development' &&
            process.env.OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS === 'true'
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
          lastError = 'A previously dispatched attempt was offered again.';
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
              if (result?.cancelRequested) controller.abort();
              else if (result && authority?.valid)
                authority.renew(result.leaseExpiresAt, attempt!.executionDeadlineAt);
            })
            .catch(error => {
              lastError = 'Execution lease renewal failed.';
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
        lastError = null;
      } catch (error) {
        if (renewTimer) clearInterval(renewTimer);
        authority?.dispose();
        active = 0;
        lastError = error instanceof Error ? error.message : String(error);
        activeController = null;
        // Stop accepting work if a known outcome cannot reach durable storage.
        if (outcomeKnown && !resultPersisted) throw error;
        if (attempt && started && !resultPersisted) {
          await spool.put({
            attemptId: attempt.attemptId,
            leaseToken: attempt.leaseToken,
            producedAt: new Date().toISOString(),
            status: shuttingDown ? 'UNKNOWN' : lastError.startsWith('LOCAL_POLICY_DENIED') ? 'FAILED' : 'UNKNOWN',
            errorCode: shuttingDown
              ? 'AGENT_INTERRUPTED_BY_SHUTDOWN'
              : lastError.startsWith('LOCAL_POLICY_DENIED')
                ? 'LOCAL_POLICY_DENIED'
                : 'AGENT_FAILURE',
            errorMessage: shuttingDown
              ? 'Execution was interrupted by process shutdown; target state is unknown.'
              : lastError,
          });
        }
        if (shuttingDown) {
          await flushSpool().catch(() => undefined);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    clearInterval(healthTimer);
    abortUnfinishedExecution();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}

void run().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
