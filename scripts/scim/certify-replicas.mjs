import { PrismaClient } from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith('/enterprise_scim_test')
)
  throw new Error('Use the isolated enterprise_scim_test database.');
const origins = (process.env.SCIM_CERT_REPLICA_URLS ?? '').split(',').filter(Boolean);
if (
  origins.length < 2 ||
  origins.some(origin => !['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
)
  throw new Error('Supply at least two local disposable SCIM_CERT_REPLICA_URLS.');
if (!process.env.NEXTAUTH_SECRET)
  throw new Error('Supply the disposable NEXTAUTH_SECRET shared by test replicas.');
const db = new PrismaClient();
const connectorId = `replica-cert-${Date.now()}`;
const token = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(token).digest('hex');
async function call(origin, method, path, body) {
  return fetch(`${origin}/api/scim/v2/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
}
try {
  await db.scimConnector.create({
    data: { id: connectorId, name: 'Disposable replica certification' },
  });
  const credential = await db.scimCredential.create({
    data: {
      connectorId,
      name: 'Replica certification',
      tokenHash,
      tokenHint: token.slice(-4),
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      createdBy: 'isolated-certifier',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  for (const origin of origins)
    assert.equal((await call(origin, 'GET', 'Users?count=0')).status, 200);
  const payload = {
    userName: `${connectorId}@example.test`,
    externalId: connectorId,
    displayName: 'Concurrent replica identity',
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      call(origins[index % origins.length], 'POST', 'Users', payload)
    )
  );
  assert.equal(results.filter(response => response.status === 201).length, 1);
  assert.equal(results.filter(response => response.status === 409).length, 7);
  const user = await results.find(response => response.status === 201).json();
  assert.equal(await db.scimIdentity.count({ where: { connectorId, externalId: connectorId } }), 1);
  assert.equal(
    (
      await call(origins[1], 'PATCH', `Users/${user.id}`, {
        Operations: [{ op: 'replace', path: 'active', value: false }],
      })
    ).status,
    200
  );
  assert.equal((await (await call(origins[0], 'GET', `Users/${user.id}`)).json()).active, false);
  const digest = createHmac('sha256', process.env.NEXTAUTH_SECRET)
    .update(`scim:connector\0${connectorId}`)
    .digest('hex');
  const window = Math.floor(Date.now() / 60000);
  const key = `auth:scim:connector:${digest}:${window}`;
  await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 600, expiresAt: new Date(Date.now() + 60000) },
    update: { count: 600 },
  });
  try {
    for (const origin of origins) {
      const response = await call(origin, 'GET', 'Users?count=0');
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '60');
    }
  } finally {
    await db.rateLimit.deleteMany({ where: { key } });
  }
  await db.scimCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
  for (const origin of origins)
    assert.equal((await call(origin, 'GET', 'Users?count=0')).status, 401);
  console.log(
    JSON.stringify({
      replicas: origins.length,
      concurrentRequests: 8,
      uniqueIdentities: 1,
      crossReplicaDeactivation: 'passed',
      sharedAdmission: 'passed',
      revocation: 'passed',
    })
  );
} finally {
  await db.scimCredential.updateMany({
    where: { connectorId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await db.$disconnect();
}
