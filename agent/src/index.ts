#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AgentClient, enrollAgent } from './client';
import { executeAttempt } from './executor';
import { assertPolicyAllows, loadPolicy } from './policy';
import { ResultSpool } from './spool';
import type { AgentIdentity, ClaimedAttempt, SpoolRecord } from './types';

const baseUrl = process.env.OPSKNIGHT_URL?.trim();
const dataDirectory = process.env.OPSKNIGHT_AGENT_DATA_DIR ?? '/var/lib/opsknight-agent';
const identityPath = process.env.OPSKNIGHT_AGENT_IDENTITY_FILE ?? `${dataDirectory}/identity.json`;
const policyPath = process.env.OPSKNIGHT_AGENT_POLICY_FILE ?? '/etc/opsknight-agent/policy.json';

if (!baseUrl) throw new Error('OPSKNIGHT_URL is required.');

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
  attempt: ClaimedAttempt,
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
    .map(key => attempt.inputValues[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length);
  return secretValues.reduce((redacted, value) => redacted.split(value).join('[REDACTED]'), output);
}

async function run() {
  const identity = await loadIdentity();
  const { policy, hash: policyHash } = await loadPolicy(policyPath);
  const client = new AgentClient(baseUrl!, identity);
  const spool = new ResultSpool(`${dataDirectory}/spool`);
  await spool.initialize();
  let active = 0;
  let lastError: string | null = null;
  let shuttingDown = false;
  let activeController: AbortController | null = null;

  const flushSpool = async () => {
    for (const record of await spool.list()) {
      try {
        await client.submit(record);
        await spool.remove(record.attemptId);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  };

  const heartbeat = async () => {
    await client.heartbeat({
      capabilities: policy.allowedStepTypes.map(type => `RUNBOOK_${type}`),
      policyHash,
      spoolDepth: await spool.depth(),
      activeAttemptCount: active,
      lastError,
    });
  };
  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat().catch(() => undefined), 30_000);

  const shutdown = () => {
    shuttingDown = true;
    activeController?.abort();
    clearInterval(heartbeatTimer);
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  while (!shuttingDown) {
    await flushSpool();
    let attempt: ClaimedAttempt | null = null;
    let started = false;
    let renewTimer: NodeJS.Timeout | null = null;
    try {
      attempt = await client.claim();
      if (!attempt) continue;
      await client.start(attempt.attemptId, attempt.leaseToken);
      started = true;
      assertPolicyAllows(attempt, policy);
      active += 1;
      const controller = new AbortController();
      activeController = controller;
      renewTimer = setInterval(() => {
        void client
          .renew(attempt!.attemptId, attempt!.leaseToken)
          .then(result => {
            if (result?.cancelRequested) controller.abort();
          })
          .catch(() => undefined);
      }, 10_000);
      const result = await executeAttempt(attempt, policy, controller.signal);
      clearInterval(renewTimer);
      renewTimer = null;
      activeController = null;
      active -= 1;
      const redactedOutput = redactSecretInputs(attempt, result.output);
      const record: SpoolRecord = {
        attemptId: attempt.attemptId,
        leaseToken: attempt.leaseToken,
        producedAt: new Date().toISOString(),
        status: result.status,
        exitCode: result.exitCode,
        outputPreview: redactedOutput.slice(0, 32_768),
        outputArtifactId: await uploadOutput(client, attempt, redactedOutput).catch(
          () => undefined
        ),
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      };
      await spool.put(record);
      await flushSpool();
      lastError = null;
    } catch (error) {
      if (renewTimer) clearInterval(renewTimer);
      active = 0;
      lastError = error instanceof Error ? error.message : String(error);
      activeController = null;
      if (attempt && started) {
        await spool.put({
          attemptId: attempt.attemptId,
          leaseToken: attempt.leaseToken,
          producedAt: new Date().toISOString(),
          status: 'FAILED',
          errorCode: lastError.startsWith('LOCAL_POLICY_DENIED')
            ? 'LOCAL_POLICY_DENIED'
            : 'AGENT_FAILURE',
          errorMessage: lastError,
        });
      }
      if (shuttingDown) break;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
}

void run().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
