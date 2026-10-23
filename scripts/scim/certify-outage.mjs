import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (url.pathname !== '/enterprise_scim_test' || !['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('Use the local isolated enterprise_scim_test database.');
const docker =
  process.env.SCIM_CERT_DOCKER ?? '/Applications/Docker.app/Contents/Resources/bin/docker';
const container = 'opsknight-scim-cert-db';
const label = execFileSync(
  docker,
  ['inspect', container, '--format', '{{index .Config.Labels "opsknight.scim.certification"}}'],
  { encoding: 'utf8' }
).trim();
if (label !== '20261021')
  throw new Error('Refusing to stop a container without the dedicated SCIM certification label.');
const origins = (process.env.SCIM_CERT_REPLICA_URLS ?? '').split(',').filter(Boolean);
if (
  origins.length < 2 ||
  origins.some(origin => !['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
)
  throw new Error('Supply at least two local disposable app replicas.');
const db = new PrismaClient();
const connectorId = `outage-cert-${Date.now()}`;
const token = randomBytes(32).toString('hex');
let stopped = false;
const request = (origin, method, path, body) =>
  fetch(`${origin}/api/scim/v2/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
async function recover() {
  execFileSync(docker, ['start', container], { stdio: 'pipe' });
  for (let i = 0; i < 30; i++) {
    try {
      execFileSync(
        docker,
        [
          'exec',
          container,
          'pg_isready',
          '-U',
          decodeURIComponent(url.username),
          '-d',
          'enterprise_scim_test',
        ],
        { stdio: 'pipe' }
      );
      stopped = false;
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Dedicated SCIM PostgreSQL fixture did not recover.');
}
try {
  await db.scimConnector.create({
    data: { id: connectorId, name: 'Disposable outage certification' },
  });
  await db.scimCredential.create({
    data: {
      connectorId,
      name: 'Outage certification',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      tokenHint: token.slice(-4),
      scopes: ['users:read', 'users:write'],
      createdBy: 'isolated-certifier',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const user = await db.user.create({
    data: {
      name: 'Outage fixture',
      email: `${connectorId}@example.test`,
      status: 'ACTIVE',
      scimIdentities: { create: { connectorId, externalId: connectorId } },
    },
  });
  for (const origin of origins)
    assert.equal((await request(origin, 'GET', `Users/${user.id}`)).status, 200);
  const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  execFileSync(docker, ['stop', '-t', '5', container], { stdio: 'pipe' });
  stopped = true;
  for (const origin of origins) {
    const response = await request(origin, 'PATCH', `Users/${user.id}`, {
      Operations: [{ op: 'replace', path: 'active', value: false }],
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(
      (await response.json()).detail,
      'Provisioning is temporarily unavailable. Retry the request.'
    );
  }
  await recover();
  // Discard the certifier pool: PostgreSQL restart closes its existing sockets.
  await db.$disconnect();
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: user.id } }), before);
  for (const origin of origins) {
    let status;
    for (let attempt = 0; attempt < 10; attempt++) {
      status = (await request(origin, 'GET', `Users/${user.id}`)).status;
      if (status === 200) break;
      assert.equal(status, 503);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(status, 200);
  }
  console.log(
    JSON.stringify({
      replicas: origins.length,
      databaseOutage: 'retryable 503; no fallback',
      failedMutation: 'rolled back',
      restartRecovery: 'passed',
    })
  );
} finally {
  if (stopped) await recover();
  await db.scimCredential.updateMany({ where: { connectorId }, data: { revokedAt: new Date() } });
  await db.$disconnect();
}
