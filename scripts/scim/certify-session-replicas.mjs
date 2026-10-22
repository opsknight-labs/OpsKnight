import assert from 'node:assert/strict';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import jwt from 'next-auth/jwt';
const { encode } = jwt;
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(url.pathname, '/enterprise_scim_test');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const origins = (process.env.SCIM_CERT_REPLICA_URLS ?? '').split(',').filter(Boolean);
assert.ok(
  origins.length >= 2 &&
    origins.every(origin => ['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
);
assert.ok(process.env.NEXTAUTH_SECRET);
const db = new PrismaClient();
const id = `session-replica-${Date.now()}`;
const scimToken = randomBytes(32).toString('hex');
const secret = process.env.NEXTAUTH_SECRET;
const signing = process.env.API_KEY_SECRET ?? secret;
const observations = [];
async function sessionCookie(user) {
  const token = await encode({
    secret,
    maxAge: 3600,
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tokenVersion: user.tokenVersion,
      authProvider: 'credentials',
      sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      absoluteExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      lastActivityAt: Date.now(),
    },
  });
  return `next-auth.session-token=${token}`;
}
async function session(origin, cookie) {
  const response = await fetch(`${origin}/api/auth/session`, {
    headers: { cookie },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function scim(origin, method, path, body) {
  const response = await fetch(`${origin}/api/scim/v2/${path}`, {
    method,
    headers: { authorization: `Bearer ${scimToken}`, 'content-type': 'application/scim+json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  return response;
}
try {
  await db.scimConnector.create({ data: { id, name: 'Disposable session replica certification' } });
  await db.scimCredential.create({
    data: {
      connectorId: id,
      name: 'Session replica test',
      tokenHash: createHash('sha256').update(scimToken).digest('hex'),
      tokenHint: scimToken.slice(-4),
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      createdBy: 'isolated-certifier',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const user = await db.user.create({
    data: {
      name: 'Session replica fixture',
      email: `${id}@example.test`,
      status: 'ACTIVE',
      role: 'RESPONDER',
      scimIdentities: { create: { connectorId: id, externalId: id } },
    },
  });
  const cookie = await sessionCookie(user);
  for (const origin of origins) assert.equal((await session(origin, cookie)).user?.id, user.id);
  for (const origin of origins)
    assert.equal((await scim(origin, 'GET', `Users/${user.id}`)).status, 200);
  const started = performance.now();
  assert.equal(
    (
      await scim(origins[0], 'PATCH', `Users/${user.id}`, {
        Operations: [{ op: 'replace', path: 'active', value: false }],
      })
    ).status,
    200
  );
  for (const origin of origins) assert.equal((await session(origin, cookie)).user?.id, undefined);
  observations.push({
    scenario: 'deactivation warmed sessions',
    observedMs: performance.now() - started,
  });
  await db.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
  const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const freshCookie = await sessionCookie(current);
  for (const origin of origins)
    assert.equal((await session(origin, freshCookie)).user?.role, 'RESPONDER');
  const downgradeStarted = performance.now();
  await db.user.update({
    where: { id: user.id },
    data: { role: 'USER', tokenVersion: { increment: 1 } },
  });
  for (const origin of origins)
    assert.equal((await session(origin, freshCookie)).user?.id, undefined);
  observations.push({
    scenario: 'role downgrade warmed sessions',
    observedMs: performance.now() - downgradeStarted,
  });
  const apiToken = `ok_test_${randomBytes(32).toString('base64url')}`;
  await db.apiKey.create({
    data: {
      name: 'Disposable replica access',
      userId: user.id,
      prefix: apiToken.slice(0, 12),
      tokenHash: createHmac('sha256', signing)
        .update(`opsknight:api-key:v2:${apiToken}`)
        .digest('hex'),
      scopes: ['teams:read'],
    },
  });
  const owner = await db.user.create({
    data: { name: 'Independent owner', email: `owner-${id}@example.test`, status: 'ACTIVE' },
  });
  const team = await db.team.create({
    data: {
      name: id,
      members: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: user.id, role: 'MEMBER' },
        ],
      },
    },
    include: { members: true },
  });
  const group = await db.scimGroup.create({
    data: {
      connectorId: id,
      name: id,
      memberships: { create: { userId: user.id } },
      bindings: { create: { teamId: team.id, approvedBy: owner.id } },
    },
    include: { bindings: true },
  });
  await db.scimTeamGrant.create({
    data: {
      bindingId: group.bindings[0].id,
      userId: user.id,
      teamMemberId: team.members.find(member => member.userId === user.id).id,
    },
  });
  const access = origin =>
    fetch(`${origin}/api/v2/teams/${team.id}/members`, {
      headers: { authorization: `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(30000),
    });
  const teamCookie = await sessionCookie(
    await db.user.findUniqueOrThrow({ where: { id: user.id } })
  );
  for (const origin of origins) {
    assert.equal((await access(origin)).status, 200);
    assert.equal((await session(origin, teamCookie)).user?.id, user.id);
  }
  const removedStarted = performance.now();
  assert.equal((await scim(origins[0], 'DELETE', `Groups/${group.id}`)).status, 204);
  for (const origin of origins) {
    assert.equal((await access(origin)).status, 403);
    assert.equal((await session(origin, teamCookie)).user?.id, undefined);
  }
  observations.push({
    scenario: 'team grant removal warmed sessions and API',
    observedMs: performance.now() - removedStarted,
  });
  assert.ok(observations.every(observation => observation.observedMs < 5000));
  console.log(
    JSON.stringify({
      replicas: origins.length,
      cachedRevocationWindowMs: 0,
      measuredSequentialObservationBudgetMs: 5000,
      observations,
      note: 'Committed state is read for each new session/API authorization; already executing requests are outside this bound.',
    })
  );
} finally {
  await db.scimCredential.updateMany({
    where: { connectorId: id },
    data: { revokedAt: new Date() },
  });
  await db.$disconnect();
}
