import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Client } from '../../sdk/typescript/dist/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error('Live SDK certification requires a dedicated database whose name ends in _test.');
}
const port = Number(process.env.API_SDK_TEST_PORT ?? 3159);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid API_SDK_TEST_PORT.');
const secret = randomBytes(32).toString('hex');
const token = `ok_test_${randomBytes(32).toString('base64url')}`;
const prisma = new PrismaClient();
let keyId;
const server = spawn(process.execPath, ['.next/standalone/server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '0.0.0.0',
    NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
    API_KEY_SECRET: secret,
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    APP_HOST_ALIASES: 'host.docker.internal',
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  },
  stdio: 'ignore',
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error('Built application exited before readiness.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v2/openapi.json`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        await response.body?.cancel();
        ready = true;
        break;
      }
      await response.body?.cancel();
    } catch {
      /* The application is still starting. */
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Built application did not become ready.');
  const user = await prisma.user.create({
    data: {
      name: 'Live SDK certifier',
      email: `sdk-${randomUUID()}@example.com`,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  const key = await prisma.apiKey.create({
    data: {
      name: 'Ephemeral live SDK certification',
      userId: user.id,
      prefix: token.slice(0, 12),
      tokenHash: createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex'),
      scopes: [
        'admin:manage',
        'runbooks:read',
        'runbooks:write',
        'runbooks:publish',
        'runbooks:execute',
      ],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  keyId = key.id;
  const client = new Client({
    baseUrl: `http://127.0.0.1:${port}/api/v2`,
    token,
    allowInsecureHttp: true,
  });
  const suffix = randomUUID();
  const request = {
    body: { name: 'TypeScript live SDK verification', slug: `typescript-sdk-${suffix}` },
    headers: { 'Idempotency-Key': `create-${suffix}` },
  };
  const created = await client.call('createRunbook', request);
  const replay = await client.call('createRunbook', request);
  if (created.data.id !== replay.data.id)
    throw new Error('Live create replay duplicated a runbook.');
  const params = { id: created.data.id, versionId: created.data.draftVersionId };
  await client.call('validateRunbookDraft', { params, body: {} });
  const published = await client.call('publishRunbookDraft', {
    params,
    body: {},
    headers: { 'If-Match': '"0"', 'Idempotency-Key': `publish-${suffix}` },
  });
  if (published.data.state !== 'PUBLISHED') throw new Error('Live runbook publication failed.');
  const preview = await client.call('previewRunbookExecution', {
    params: { id: created.data.id },
    body: {},
  });
  const execution = await client.call('executeRunbook', {
    params: { id: created.data.id },
    body: { expectedPlanDigest: preview.data.digest },
    headers: { 'Idempotency-Key': `execute-${suffix}` },
  });
  const cancellation = await client.call('cancelRunbookExecution', {
    params: { id: execution.data.executionId },
    body: { reason: 'Live SDK certification complete' },
    headers: { 'Idempotency-Key': `cancel-${suffix}` },
  });
  if (cancellation.data.status !== 'CANCEL_REQUESTED')
    throw new Error('Live cancellation did not preserve request semantics.');
  console.log(
    'TypeScript live replay/publication/preview/execution/cancellation workflows passed.'
  );
  const python = spawnSync(
    process.env.DOCKER_BIN ?? 'docker',
    [
      'run',
      '--rm',
      '-i',
      ...(process.platform === 'linux' ? ['--add-host=host.docker.internal:host-gateway'] : []),
      '-v',
      `${process.cwd()}:/work:ro`,
      '-w',
      '/work',
      'python:3.12-alpine',
      'python',
      'tests/sdk/live-workflow.py',
    ],
    {
      input: JSON.stringify({
        baseUrl: `http://host.docker.internal:${port}/api/v2`,
        token,
        typescriptRunbookId: created.data.id,
      }),
      encoding: 'utf8',
      timeout: 90_000,
    }
  );
  if (python.stdout) process.stdout.write(python.stdout);
  if (python.status !== 0)
    throw new Error(`Python live workflow failed (${python.status}): ${python.stderr}`);
  console.log('Both SDKs passed against the built OpsKnight application and PostgreSQL.');
} finally {
  try {
    if (keyId)
      await prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  } finally {
    server.kill('SIGTERM');
    await prisma.$disconnect();
  }
}
