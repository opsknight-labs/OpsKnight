/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REST v2 runtime certification against a real PostgreSQL database.
 *
 * Calls the real route handlers with real bearer tokens, so authentication, rate limiting,
 * authorization, idempotency, optimistic concurrency and audit all run against the database.
 */
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashTokenV2 } from '@/lib/api-keys';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';
import { POST as createTeam } from '@/app/api/v2/teams/route';
import { GET as getTeam, PATCH as patchTeam } from '@/app/api/v2/teams/[id]/route';
import {
  GET as getPolicy,
  PATCH as patchPolicy,
} from '@/app/api/v2/escalation-policies/[id]/route';
import { PATCH as patchIncident } from '@/app/api/v2/incidents/[id]/route';
import { POST as assignIncident } from '@/app/api/v2/incidents/[id]/assign/route';
import { GET as listTeams } from '@/app/api/v2/teams/route';
import { POST as createServiceAccount } from '@/app/api/v2/service-accounts/route';
import { POST as issueToken } from '@/app/api/v2/service-accounts/[id]/tokens/route';
import { DELETE as deleteServiceAccount } from '@/app/api/v2/service-accounts/[id]/route';
import { GET as listAuditLogs } from '@/app/api/v2/audit-logs/route';
import { POST as retryNotification } from '@/app/api/v2/notifications/[id]/retry/route';
import { PATCH as patchStatusPage } from '@/app/api/v2/status-pages/[id]/route';

type Handler = (req: NextRequest, ctx?: any) => Promise<Response>;

async function makeKey(role: 'ADMIN' | 'RESPONDER', scopes: string[] = ['admin:manage']) {
  const user = await createTestUser({
    role,
    email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
  });
  const token = `ok_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const key = await testPrisma.apiKey.create({
    data: {
      name: 'runtime certification',
      prefix: token.slice(0, 12),
      tokenHash: hashTokenV2(token),
      scopes,
      userId: user.id,
    },
  });
  return { user, token, key };
}

function call(
  handler: Handler,
  token: string,
  method: string,
  url: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {}
) {
  const req = new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return handler(req, { params: Promise.resolve(options.params ?? {}) });
}

describe('API v2 runtime certification (PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 120_000);

  describe('optimistic concurrency', () => {
    it('two writers holding the same ETag: exactly one succeeds and one gets 412', async () => {
      const { token } = await makeKey('ADMIN');
      const team = await createTestTeam('race');
      const read = await call(getTeam, token, 'GET', `/api/v2/teams/${team.id}`, {
        params: { id: team.id },
      });
      const etag = read.headers.get('etag')!;
      expect(etag).toMatch(/^"\d+"$/);

      const results = await Promise.all(
        ['writer-a', 'writer-b'].map(name =>
          call(patchTeam, token, 'PATCH', `/api/v2/teams/${team.id}`, {
            body: { name: `${name}-${randomUUID().slice(0, 6)}` },
            headers: { 'if-match': etag },
            params: { id: team.id },
          })
        )
      );
      expect(results.map(r => r.status).sort()).toEqual([200, 412]);
      const loser = results.find(r => r.status === 412)!;
      expect(loser.headers.get('content-type')).toContain('application/problem+json');
    });

    it('twenty rapid consecutive writes each get a fresh validator and none is lost', async () => {
      const { token } = await makeKey('ADMIN');
      const team = await createTestTeam('rapid');
      let etag = (
        await call(getTeam, token, 'GET', `/api/v2/teams/${team.id}`, { params: { id: team.id } })
      ).headers.get('etag')!;
      const seen = new Set<string>([etag]);

      for (let i = 0; i < 20; i++) {
        const res = await call(patchTeam, token, 'PATCH', `/api/v2/teams/${team.id}`, {
          body: { description: `revision ${i}` },
          headers: { 'if-match': etag },
          params: { id: team.id },
        });
        expect(res.status, `write ${i}`).toBe(200);
        etag = res.headers.get('etag')!;
        expect(seen.has(etag), `validator reused at write ${i}`).toBe(false);
        seen.add(etag);
      }
      expect((await testPrisma.team.findUnique({ where: { id: team.id } }))?.description).toBe(
        'revision 19'
      );
    });

    it('a stale ETag cannot overwrite a newer change', async () => {
      const { token } = await makeKey('ADMIN');
      const team = await createTestTeam('stale');
      const first = (
        await call(getTeam, token, 'GET', `/api/v2/teams/${team.id}`, { params: { id: team.id } })
      ).headers.get('etag')!;
      await call(patchTeam, token, 'PATCH', `/api/v2/teams/${team.id}`, {
        body: { description: 'newer' },
        headers: { 'if-match': first },
        params: { id: team.id },
      });
      const stale = await call(patchTeam, token, 'PATCH', `/api/v2/teams/${team.id}`, {
        body: { description: 'older overwrite' },
        headers: { 'if-match': first },
        params: { id: team.id },
      });
      expect(stale.status).toBe(412);
      expect((await testPrisma.team.findUnique({ where: { id: team.id } }))?.description).toBe(
        'newer'
      );
    });

    it('a weak validator in If-Match is refused with 412', async () => {
      const { token } = await makeKey('ADMIN');
      const team = await createTestTeam('weak');
      const etag = (
        await call(getTeam, token, 'GET', `/api/v2/teams/${team.id}`, { params: { id: team.id } })
      ).headers.get('etag')!;
      const res = await call(patchTeam, token, 'PATCH', `/api/v2/teams/${team.id}`, {
        body: { description: 'x' },
        headers: { 'if-match': `W/${etag}` },
        params: { id: team.id },
      });
      expect(res.status).toBe(412);
    });

    it('a steps-only escalation policy edit changes the ETag', async () => {
      const { token } = await makeKey('ADMIN');
      const responder = await createTestUser({ role: 'RESPONDER' });
      const other = await createTestUser({ role: 'RESPONDER' });
      const policy = await createTestEscalationPolicy('steps-only', [
        { stepOrder: 0, targetType: 'USER', targetUserId: responder.id, delayMinutes: 0 },
      ]);
      const before = (
        await call(getPolicy, token, 'GET', `/api/v2/escalation-policies/${policy.id}`, {
          params: { id: policy.id },
        })
      ).headers.get('etag')!;

      const patched = await call(
        patchPolicy,
        token,
        'PATCH',
        `/api/v2/escalation-policies/${policy.id}`,
        {
          body: { steps: [{ targetType: 'USER', targetId: other.id, delayMinutes: 5 }] },
          headers: { 'if-match': before },
          params: { id: policy.id },
        }
      );
      expect(patched.status).toBe(200);
      const after = patched.headers.get('etag')!;
      expect(after).not.toBe(before);

      // The old validator is now stale.
      const stale = await call(
        patchPolicy,
        token,
        'PATCH',
        `/api/v2/escalation-policies/${policy.id}`,
        {
          body: { steps: [{ targetType: 'USER', targetId: responder.id, delayMinutes: 9 }] },
          headers: { 'if-match': before },
          params: { id: policy.id },
        }
      );
      expect(stale.status).toBe(412);
    });
  });

  describe('idempotency', () => {
    it('concurrent creates with one Idempotency-Key produce a single resource', async () => {
      const { token } = await makeKey('ADMIN');
      const key = `idem-${randomUUID()}`;
      const name = `Idempotent Team ${randomUUID().slice(0, 8)}`;

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          call(createTeam, token, 'POST', '/api/v2/teams', {
            body: { name },
            headers: { 'idempotency-key': key },
          })
        )
      );

      expect(await testPrisma.team.count({ where: { name } })).toBe(1);
      const created = responses.filter(r => r.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);
      // Anything that is not a replay or the original must be a retryable conflict, never a duplicate.
      for (const r of responses) expect([201, 409]).toContain(r.status);

      const audit = await testPrisma.auditLog.count({ where: { action: 'team.created' } });
      expect(audit).toBe(1);
    });

    it('reusing a key with a different body is rejected', async () => {
      const { token } = await makeKey('ADMIN');
      const key = `idem-${randomUUID()}`;
      const first = await call(createTeam, token, 'POST', '/api/v2/teams', {
        body: { name: `First ${randomUUID().slice(0, 8)}` },
        headers: { 'idempotency-key': key },
      });
      expect(first.status).toBe(201);
      const second = await call(createTeam, token, 'POST', '/api/v2/teams', {
        body: { name: `Second ${randomUUID().slice(0, 8)}` },
        headers: { 'idempotency-key': key },
      });
      expect(second.status).toBe(409);
      expect(await testPrisma.team.count()).toBe(1);
    });

    it('replaying the same key returns the original resource with Idempotency-Replayed', async () => {
      const { token } = await makeKey('ADMIN');
      const key = `idem-${randomUUID()}`;
      const body = { name: `Replay ${randomUUID().slice(0, 8)}` };
      const first = await call(createTeam, token, 'POST', '/api/v2/teams', {
        body,
        headers: { 'idempotency-key': key },
      });
      const replay = await call(createTeam, token, 'POST', '/api/v2/teams', {
        body,
        headers: { 'idempotency-key': key },
      });
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
      expect((await replay.json()).data.id).toBe((await first.json()).data.id);
      expect(await testPrisma.team.count()).toBe(1);
    });
  });

  describe('audit atomicity', () => {
    it('commits the audit record with the change, attributed to the API key', async () => {
      const { token, key } = await makeKey('ADMIN');
      const res = await call(createTeam, token, 'POST', '/api/v2/teams', {
        body: { name: `Audited ${randomUUID().slice(0, 8)}` },
      });
      expect(res.status).toBe(201);
      const id = (await res.json()).data.id;
      const row = await testPrisma.auditLog.findFirst({
        where: { action: 'team.created', entityId: id },
      });
      expect(row).not.toBeNull();
      // Caller details live under the audit envelope's `metadata`.
      expect((row!.details as any).metadata.apiClientId).toBe(key.id);
      expect((row!.details as any).metadata.apiGateway).toBe('api_v2');
      expect((row!.details as any).source).toBe('API');
    });

    it('API Activity selects exactly the gateway rows in the database and filters by key', async () => {
      const first = await makeKey('ADMIN');
      const second = await makeKey('ADMIN');
      await call(createTeam, first.token, 'POST', '/api/v2/teams', {
        body: { name: `Act A ${randomUUID().slice(0, 8)}` },
      });
      await call(createTeam, second.token, 'POST', '/api/v2/teams', {
        body: { name: `Act B ${randomUUID().slice(0, 8)}` },
      });
      // A non-API audit row must not appear.
      await testPrisma.auditLog.create({
        data: { action: 'team.created', entityType: 'TEAM', details: { source: 'UI' } },
      });
      // Noise that would have crowded a fixed-size window.
      await testPrisma.auditLog.createMany({
        data: Array.from({ length: 150 }, () => ({
          action: 'incident.updated',
          entityType: 'INCIDENT' as const,
          details: { source: 'UI' },
        })),
      });

      const { buildApiActivityWhere, parseApiActivityFilters } =
        await import('@/lib/api-v2/activity-query');
      const all = await testPrisma.auditLog.findMany({ where: buildApiActivityWhere({}) });
      expect(all).toHaveLength(2);

      const byKey = await testPrisma.auditLog.findMany({
        where: buildApiActivityWhere(parseApiActivityFilters({ key: second.key.id })),
      });
      expect(byKey).toHaveLength(1);
      expect((byKey[0].details as any).metadata.apiClientId).toBe(second.key.id);
    });

    it('rolls the mutation back when the audit write fails, so nothing commits unaudited', async () => {
      const { token } = await makeKey('ADMIN');
      await testPrisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION cert_fail_audit() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'injected audit failure'; END;
        $$ LANGUAGE plpgsql;`);
      await testPrisma.$executeRawUnsafe(
        `CREATE TRIGGER cert_fail_audit_trg BEFORE INSERT ON "AuditLog"
         FOR EACH ROW WHEN (NEW.action = 'team.created') EXECUTE FUNCTION cert_fail_audit();`
      );
      try {
        const name = `Unaudited ${randomUUID().slice(0, 8)}`;
        const res = await call(createTeam, token, 'POST', '/api/v2/teams', { body: { name } });
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(await testPrisma.team.count({ where: { name } })).toBe(0);
      } finally {
        await testPrisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS cert_fail_audit_trg ON "AuditLog"`
        );
        await testPrisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS cert_fail_audit()`);
      }
    });
  });

  describe('incident assignment parity', () => {
    async function assignedState(incidentId: string) {
      const incident = await testPrisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
      const events = await testPrisma.incidentEvent.findMany({
        where: { incidentId },
        select: { type: true, message: true },
        orderBy: { createdAt: 'asc' },
      });
      const jobs = await testPrisma.backgroundJob.findMany({
        where: { payload: { path: ['incidentId'], equals: incidentId } },
        select: { type: true, payload: true },
      });
      return {
        assigneeId: incident.assigneeId,
        teamId: incident.teamId,
        events: events.map(e => `${e.type}:${e.message}`),
        jobs: jobs
          .map(j => `${j.type}:${(j.payload as any).effect ?? (j.payload as any).kind ?? ''}`)
          .sort(),
      };
    }

    it('PATCH assigneeId and POST /assign leave identical state, timeline and outbox', async () => {
      const { token } = await makeKey('ADMIN');
      const team = await createTestTeam('parity');
      const service = await createTestService('parity-svc', team.id);
      const assignee = await createTestUser({ role: 'RESPONDER' });
      const viaPatch = await createTestIncident('via patch', service.id);
      const viaAssign = await createTestIncident('via assign', service.id);

      const patched = await call(
        patchIncident,
        token,
        'PATCH',
        `/api/v2/incidents/${viaPatch.id}`,
        {
          body: { assigneeId: assignee.id },
          params: { id: viaPatch.id },
        }
      );
      const assigned = await call(
        assignIncident,
        token,
        'POST',
        `/api/v2/incidents/${viaAssign.id}/assign`,
        { body: { assigneeId: assignee.id }, params: { id: viaAssign.id } }
      );
      expect(patched.status).toBe(200);
      expect(assigned.status).toBe(200);

      const a = await assignedState(viaPatch.id);
      const b = await assignedState(viaAssign.id);
      expect(a.assigneeId).toBe(assignee.id);
      expect(a).toEqual(b);
    });

    it('rejects assigning to a user and a team together and an empty body', async () => {
      const { token } = await makeKey('ADMIN');
      const team = await createTestTeam('both');
      const service = await createTestService('both-svc', team.id);
      const user = await createTestUser({ role: 'RESPONDER' });
      const incident = await createTestIncident('strict', service.id, { assigneeId: user.id });

      const both = await call(
        assignIncident,
        token,
        'POST',
        `/api/v2/incidents/${incident.id}/assign`,
        {
          body: { assigneeId: user.id, teamId: team.id },
          params: { id: incident.id },
        }
      );
      const empty = await call(
        assignIncident,
        token,
        'POST',
        `/api/v2/incidents/${incident.id}/assign`,
        {
          body: {},
          params: { id: incident.id },
        }
      );
      expect(both.status).toBe(400);
      expect(empty.status).toBe(400);
      // Neither request may have unassigned the incident.
      expect(
        (await testPrisma.incident.findUnique({ where: { id: incident.id } }))?.assigneeId
      ).toBe(user.id);
    });
  });

  describe('credentials and abuse protection', () => {
    it('a revoked key stops working on the very next request', async () => {
      const { token, key } = await makeKey('ADMIN');
      expect((await call(listTeams, token, 'GET', '/api/v2/teams')).status).toBe(200);
      await testPrisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      expect((await call(listTeams, token, 'GET', '/api/v2/teams')).status).toBe(401);
    });

    it('a valid client behind the same address keeps working after that address floods invalid tokens', async () => {
      const { token } = await makeKey('ADMIN');
      const nat = { 'x-forwarded-for': '203.0.113.50' };
      for (let i = 0; i < 80; i++) {
        const bad = await call(
          listTeams,
          `ok_test_${randomUUID().replace(/-/g, '')}${i}`,
          'GET',
          '/api/v2/teams',
          { headers: nat }
        );
        expect([401, 429]).toContain(bad.status);
      }
      const good = await call(listTeams, token, 'GET', '/api/v2/teams', { headers: nat });
      expect(good.status).toBe(200);
    });

    it('a token cannot be issued for a disabled service account', async () => {
      const { token } = await makeKey('ADMIN');
      const created = await call(createServiceAccount, token, 'POST', '/api/v2/service-accounts', {
        body: { name: 'cert bot', role: 'RESPONDER' },
      });
      expect(created.status).toBe(201);
      const id = (await created.json()).data.id;

      const ok = await call(issueToken, token, 'POST', `/api/v2/service-accounts/${id}/tokens`, {
        body: { name: 'first', scopes: ['incidents:read'], expiresInDays: 30 },
        params: { id },
      });
      expect(ok.status).toBe(201);

      const removed = await call(
        deleteServiceAccount,
        token,
        'DELETE',
        `/api/v2/service-accounts/${id}`,
        {
          params: { id },
        }
      );
      expect([200, 204]).toContain(removed.status);

      const refused = await call(
        issueToken,
        token,
        'POST',
        `/api/v2/service-accounts/${id}/tokens`,
        {
          body: { name: 'second', scopes: ['incidents:read'], expiresInDays: 30 },
          params: { id },
        }
      );
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe('SERVICE_ACCOUNT_DISABLED');
    });
  });

  describe('audit log read projection', () => {
    it('returns attribution and never returns secrets or raw credentials', async () => {
      const { token, key } = await makeKey('ADMIN');
      await call(createTeam, token, 'POST', '/api/v2/teams', {
        body: { name: `Projected ${randomUUID().slice(0, 8)}` },
      });
      const res = await call(listAuditLogs, token, 'GET', '/api/v2/audit-logs');
      expect(res.status).toBe(200);
      const text = JSON.stringify(await res.json());
      expect(text).toContain(key.id);
      expect(text).not.toContain(token);
      expect(text).not.toMatch(/ok_test_[A-Za-z0-9]{20,}/);
    });
  });

  describe('notification retry', () => {
    it('concurrent retries of one failed notification: one succeeds, the rest get 409, one audit record', async () => {
      const { token } = await makeKey('ADMIN');
      const recipient = await createTestUser({ role: 'RESPONDER' });
      const notification = await testPrisma.notification.create({
        data: {
          userId: recipient.id,
          channel: 'EMAIL',
          status: 'FAILED',
          attempts: 1,
          maxAttempts: 3,
          payloadEncrypted: 'v1:encrypted-placeholder',
          failedAt: new Date(),
          errorMsg: 'provider unavailable',
        },
      });

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          call(retryNotification, token, 'POST', `/api/v2/notifications/${notification.id}/retry`, {
            params: { id: notification.id },
          })
        )
      );
      const statuses = responses.map(r => r.status).sort();
      expect(statuses.filter(code => code === 200)).toHaveLength(1);
      expect(statuses.filter(code => code === 409)).toHaveLength(4);
      expect(
        (await testPrisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status
      ).toBe('PENDING');
      expect(
        await testPrisma.auditLog.count({
          where: { action: 'notification.retry_requested', entityId: notification.id },
        })
      ).toBe(1);
    });
  });

  describe('status page publication', () => {
    it('PATCH reports the publication outcome after committing the change', async () => {
      const { token } = await makeKey('ADMIN');
      const page = await testPrisma.statusPage.create({
        data: {
          name: `Page ${randomUUID().slice(0, 8)}`,
          slug: `p-${randomUUID().slice(0, 8)}`,
          enabled: false,
          isDefault: false,
        },
      });
      const res = await call(patchStatusPage, token, 'PATCH', `/api/v2/status-pages/${page.id}`, {
        body: { name: `Renamed ${randomUUID().slice(0, 8)}` },
        params: { id: page.id },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()).data;
      expect(body.publication).toBeDefined();
      expect(['LIVE', 'PUBLISHING', 'FAILED', 'DISABLED']).toContain(body.publication.status);
      expect((await testPrisma.statusPage.findUniqueOrThrow({ where: { id: page.id } })).name).toBe(
        body.name
      );
      expect(
        await testPrisma.auditLog.count({
          where: { action: 'status_page.updated', entityId: page.id },
        })
      ).toBe(1);
    });
  });

  describe('credential inventory (server-side)', () => {
    it('pages through every key exactly once, and computes status filters in the database', async () => {
      const owner = await createTestUser({ role: 'ADMIN' });
      const now = new Date();
      const day = 86_400_000;
      const rows = Array.from({ length: 60 }, (_, i) => ({
        name: `inv-${String(i).padStart(2, '0')}`,
        prefix: `ok_inv_${String(i).padStart(4, '0')}`,
        tokenHash: `hash-${randomUUID()}`,
        scopes: ['incidents:read'],
        userId: owner.id,
        createdAt: new Date(now.getTime() - i * 1000),
        revokedAt: i % 5 === 0 ? now : null,
        expiresAt:
          i % 7 === 0
            ? new Date(now.getTime() - day)
            : i % 3 === 0
              ? new Date(now.getTime() + day)
              : null,
      }));
      await testPrisma.apiKey.createMany({ data: rows });

      const { buildKeyInventoryWhere, encodeInventoryCursor, KEY_INVENTORY_PAGE_SIZE } =
        await import('@/lib/api-key-inventory');

      const seen: string[] = [];
      let cursor: { createdAt: Date; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await testPrisma.apiKey.findMany({
          where: buildKeyInventoryWhere({ userId: owner.id }, { status: 'ALL', cursor }, now),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: KEY_INVENTORY_PAGE_SIZE + 1,
        });
        seen.push(...batch.slice(0, KEY_INVENTORY_PAGE_SIZE).map(k => k.id));
        if (batch.length <= KEY_INVENTORY_PAGE_SIZE) break;
        const last = batch[KEY_INVENTORY_PAGE_SIZE - 1];
        expect(encodeInventoryCursor(last)).toBeTruthy();
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      expect(seen).toHaveLength(60);
      expect(new Set(seen).size).toBe(60);

      const count = (status: 'ACTIVE' | 'REVOKED' | 'EXPIRED') =>
        testPrisma.apiKey.count({
          where: buildKeyInventoryWhere({ userId: owner.id }, { status }, now),
        });
      const [active, revoked, expired] = await Promise.all([
        count('ACTIVE'),
        count('REVOKED'),
        count('EXPIRED'),
      ]);
      expect(revoked).toBe(rows.filter(r => r.revokedAt).length);
      expect(expired).toBe(
        rows.filter(r => !r.revokedAt && r.expiresAt && r.expiresAt <= now).length
      );
      expect(active).toBe(
        rows.filter(r => !r.revokedAt && (!r.expiresAt || r.expiresAt > now)).length
      );
      // Searching reaches rows beyond the first page.
      const found = await testPrisma.apiKey.findMany({
        where: buildKeyInventoryWhere({ userId: owner.id }, { status: 'ALL', q: 'inv-59' }, now),
      });
      expect(found.map(k => k.name)).toEqual(['inv-59']);
    });
  });
});
