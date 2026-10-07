// @vitest-environment node
// Test paths are confined to fresh temporary directories.
/* eslint-disable security/detect-non-literal-fs-filename */
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { canonicalEnvelope } from '../../agent/src/envelope';
import { ResultSpool } from '../../agent/src/spool';

async function exerciseRuntime(
  mode: 'crash-before-upload' | 'lease-loss' | 'terminal-rejection' | 'spool-unwritable'
) {
  const directory = await mkdtemp(join(tmpdir(), 'opsknight-runtime-test-'));
  const controlKey = generateKeyPairSync('ed25519');
  const agentKey = generateKeyPairSync('ed25519');
  const command =
    mode === 'lease-loss'
      ? 'sleep 30'
      : mode === 'spool-unwritable'
        ? 'sleep 0.5; printf completed'
        : 'head -c 40000 /dev/zero';
  let claimCount = 0;
  let permissionTimer: NodeJS.Timeout | null = null;
  const running: { child: ChildProcess | null } = { child: null };
  let claimed = false;
  let crashInjected = false;
  let uploadSawDurableResult = false;
  let resolveSubmitted!: (value: Record<string, unknown>) => void;
  let rejectSubmitted!: (error: unknown) => void;
  const submitted = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveSubmitted = resolve;
    rejectSubmitted = reject;
  });
  const signed = (payload: object) => ({
    ...payload,
    signature: sign(null, Buffer.from(canonicalEnvelope(payload)), controlKey.privateKey).toString(
      'base64'
    ),
  });
  const acknowledgement = (payload: object) =>
    signed({
      ...payload,
      attemptId: 'attempt1',
      signingAgentId: 'agent1',
      leaseTokenHash: createHash('sha256').update('lease-token').digest('hex'),
    });
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const json = JSON.parse(body || '{}') as Record<string, unknown>;
      const send = (data: unknown) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data }));
      };
      if (request.url?.includes('/time')) {
        send({ serverTime: new Date().toISOString(), epochMs: Date.now() });
        return;
      }
      if (request.url?.includes('/claim')) {
        claimCount++;
        if (claimed) {
          response.writeHead(204);
          response.end();
          return;
        }
        claimed = true;
        send({
          attempt: signed({
            attemptId: 'attempt1',
            executionId: 'execution1',
            signingAgentId: 'agent1',
            leaseToken: 'lease-token',
            leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
            executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
            definitionChecksum: 'a'.repeat(64),
            planDigest: 'digest',
            idempotencyKey: 'key',
            inputValues: {},
            secretInputKeys: [],
            step: {
              key: 'shell',
              name: 'Shell',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              config: { command },
              timeoutSeconds: 60,
            },
          }),
        });
      } else if (request.url?.endsWith('/start')) {
        if (mode === 'spool-unwritable')
          permissionTimer = setTimeout(() => {
            void chmod(join(directory, 'data/spool'), 0o500).catch(rejectSubmitted);
          }, 100);
        send(
          signed({
            attemptId: 'attempt1',
            signingAgentId: 'agent1',
            leaseTokenHash: createHash('sha256').update(String(json.leaseToken)).digest('hex'),
            startedAt: new Date().toISOString(),
            alreadyStarted: false,
            leaseExpiresAt: new Date(
              Date.now() + (mode === 'lease-loss' ? 21500 : 60000)
            ).toISOString(),
          })
        );
      } else if (request.url?.endsWith('/jobs/attempt1/heartbeat')) {
        response.destroy();
      } else if (request.url?.endsWith('/artifacts')) {
        const record = JSON.parse(
          await readFile(join(directory, 'data/spool/attempt1.json'), 'utf8')
        ) as Record<string, unknown>;
        uploadSawDurableResult =
          record.status === 'SUCCEEDED' && typeof record.localOutput === 'string';
        if (!crashInjected) {
          crashInjected = true;
          running.child!.kill('SIGKILL');
          response.destroy();
          return;
        }
        send(acknowledgement({ id: 'artifact1' }));
      } else if (request.url?.endsWith('/result')) {
        if (json.attemptId === 'arejected') {
          response.writeHead(409, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'Expired recovery fence.' }));
          return;
        }
        resolveSubmitted(json);
        send(acknowledgement({ accepted: true }));
      } else send({});
    })().catch(error => {
      rejectSubmitted(error);
      response.destroy();
    });
  });
  try {
    await build({
      entryPoints: ['agent/src/index.ts'],
      outfile: join(directory, 'agent.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      packages: 'external',
    });
    await mkdir(join(directory, 'data'));
    await writeFile(
      join(directory, 'data/identity.json'),
      JSON.stringify({
        agentId: 'agent1',
        privateKey: agentKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKey: agentKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      })
    );
    await writeFile(
      join(directory, 'policy.json'),
      JSON.stringify({
        allowedStepTypes: ['BASH'],
        allowNonIdempotent: true,
        bashCommandPatterns: [command],
        maxRuntimeSeconds: 60,
        maxOutputBytes: 65536,
      })
    );
    if (mode === 'terminal-rejection') {
      claimed = true;
      const spool = new ResultSpool(join(directory, 'data/spool'));
      await spool.put({
        attemptId: 'arejected',
        leaseToken: 'lease-token',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
      });
      await spool.put({
        attemptId: 'attempt1',
        leaseToken: 'lease-token',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
        outputPreview: 'recovered',
      });
    }
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address.');
    const start = () => {
      running.child = spawn(process.execPath, [join(directory, 'agent.mjs')], {
        env: {
          ...process.env,
          OPSKNIGHT_URL: `http://127.0.0.1:${address.port}`,
          OPSKNIGHT_AGENT_DATA_DIR: join(directory, 'data'),
          OPSKNIGHT_AGENT_IDENTITY_FILE: join(directory, 'data/identity.json'),
          OPSKNIGHT_AGENT_POLICY_FILE: join(directory, 'policy.json'),
          OPSKNIGHT_EXECUTION_PUBLIC_KEY: controlKey.publicKey
            .export({ type: 'spki', format: 'der' })
            .toString('base64'),
        },
        stdio: 'ignore',
      });
    };
    start();
    if (mode === 'spool-unwritable') {
      const exitTimeout = setTimeout(() => running.child!.kill('SIGKILL'), 5000);
      try {
        const [exitCode] = await once(running.child!, 'exit');
        return { result: { exitCode }, uploadSawDurableResult, quarantined: 0, claimCount };
      } finally {
        clearTimeout(exitTimeout);
      }
    }
    if (mode === 'crash-before-upload') {
      await once(running.child!, 'exit');
      start();
    }
    const timeout = setTimeout(
      () => rejectSubmitted(new Error('Agent runtime did not submit its result.')),
      16000
    );
    try {
      const result = await submitted;
      return {
        result,
        uploadSawDurableResult,
        quarantined: await new ResultSpool(join(directory, 'data/spool')).deadLetterDepth(),
        claimCount,
      };
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (permissionTimer) clearTimeout(permissionTimer);
    if (running.child && running.child.exitCode === null && running.child.signalCode === null) {
      const exited = once(running.child, 'exit');
      running.child.kill('SIGTERM');
      await exited;
    }
    server.closeAllConnections();
    server.close();
    await chmod(join(directory, 'data/spool'), 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Agent runtime fault injection', () => {
  it('recovers a successful result after crashing during artifact upload', async () => {
    const { result, uploadSawDurableResult } = await exerciseRuntime('crash-before-upload');
    expect(uploadSawDurableResult).toBe(true);
    expect(result).toMatchObject({ status: 'SUCCEEDED', outputArtifactId: 'artifact1' });
    expect(result).not.toHaveProperty('localOutput');
  });
  it('self-fences a running write when renewal connectivity is unavailable', async () => {
    const { result } = await exerciseRuntime('lease-loss');
    expect(result).toMatchObject({ status: 'UNKNOWN', errorCode: 'LEASE_LOST' });
  });
  it('quarantines a permanent rejection and continues delivering later results', async () => {
    const { result, quarantined } = await exerciseRuntime('terminal-rejection');
    expect(result).toMatchObject({
      attemptId: 'attempt1',
      status: 'SUCCEEDED',
      outputPreview: 'recovered',
    });
    expect(quarantined).toBe(1);
  });
  it.skipIf(process.getuid?.() === 0)(
    'stops claiming work when a completed result cannot be persisted',
    async () => {
      const { result, claimCount } = await exerciseRuntime('spool-unwritable');
      expect(result).toMatchObject({ exitCode: 1 });
      expect(claimCount).toBe(1);
    }
  );
});
