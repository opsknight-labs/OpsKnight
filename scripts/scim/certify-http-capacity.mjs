import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(url.pathname, '/enterprise_scim_test');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const origin = new URL(process.env.SCIM_E2E_BASE_URL ?? 'http://localhost:3028');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname));
const db = new PrismaClient();
const id = `http-capacity-${Date.now()}`;
const token = randomBytes(32).toString('hex');
async function request(path, options = {}) {
  const response = await fetch(`${origin.origin}/api/scim/v2/${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}
try {
  await db.scimConnector.create({ data: { id, name: 'Disposable HTTP serialization capacity' } });
  await db.scimCredential.create({
    data: {
      connectorId: id,
      name: 'HTTP capacity',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      tokenHint: token.slice(-4),
      scopes: ['groups:read', 'groups:write'],
      createdBy: 'local-certifier',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  assert.equal(await db.user.count({ where: { id: { startsWith: 'scim-load-user-' } } }), 100000);
  await db.$executeRaw`INSERT INTO "User" (id,email,name,status,"updatedAt") SELECT ${id} || '-user-' || i, ${id} || '-' || i || '@example.test', 'HTTP capacity user ' || i, 'ACTIVE', CURRENT_TIMESTAMP FROM generate_series(1,10000) i`;
  await db.$executeRaw`INSERT INTO "ScimIdentity" (id,"connectorId","externalId","userId") SELECT ${id} || '-identity-' || i, ${id}, 'directory-' || i, ${id} || '-user-' || i FROM generate_series(1,10000) i`;
  await db.$executeRaw`INSERT INTO "ScimGroup" (id,"connectorId",name,"updatedAt") SELECT ${id} || '-' || i, ${id}, 'Large HTTP group ' || i, CURRENT_TIMESTAMP FROM generate_series(1,100) i`;
  await db.$executeRaw`INSERT INTO "ScimGroupMembership" ("groupId","userId") SELECT ${id} || '-' || g, ${id} || '-user-' || u FROM generate_series(1,100) g CROSS JOIN generate_series(1,10000) u`;
  const before = process.memoryUsage().rss;
  const cpuBefore = process.cpuUsage();
  const samples = [];
  let maxBytes = 0;
  for (let i = 0; i < 30; i++) {
    const started = performance.now();
    const { response, body, text } = await request(`Groups?count=100&startIndex=${(i % 100) + 1}`);
    assert.equal(response.status, 200);
    assert.equal(body.totalResults, 100);
    assert.equal(body.itemsPerPage, 1);
    assert.equal(body.Resources[0].members.length, 10000);
    assert.ok(Buffer.byteLength(text) < 8 * 1024 * 1024);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(text));
    samples.push(performance.now() - started);
  }
  const full = await request(`Groups/${id}-1`);
  assert.equal(full.body.members.length, 10000);
  const excluded = await request('Groups?count=100&excludedAttributes=members');
  assert.equal(excluded.body.itemsPerPage, 100);
  assert.ok(excluded.body.Resources.every(group => !('members' in group)));
  const same = await request(`Groups/${id}-1`, {
    method: 'PATCH',
    body: JSON.stringify({
      Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed large group' }],
    }),
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.body.members.length, 10000);
  const clients =
    await db.$queryRaw`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database()`;
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      groups: 100,
      membersPerGroup: 10000,
      totalMemberships: 1000000,
      httpSamples: samples.length,
      p50Ms: samples[14],
      p95Ms: samples[28],
      p99Ms: samples[29],
      maxResponseBytes: maxBytes,
      clientRssDeltaBytes: process.memoryUsage().rss - before,
      clientCpuMicros: process.cpuUsage(cpuBefore),
      databaseConnections: clients[0].connections,
      errorRate: 0,
      note: 'Client HTTP/serialization measurements; not server RSS or production SLA.',
    })
  );
} finally {
  await db.scimCredential.updateMany({
    where: { connectorId: id },
    data: { revokedAt: new Date() },
  });
  await db.scimGroup.deleteMany({ where: { connectorId: id } });
  await db.user.deleteMany({ where: { id: { startsWith: `${id}-user-` } } });
  await db.$disconnect();
}
