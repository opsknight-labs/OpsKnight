import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRoleCapabilities, type AppRole } from '@/lib/authorization';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

const actor = vi.hoisted(() => ({ id: '', role: 'ADMIN' as string }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({
    id: actor.id,
    isAdmin: actor.role === 'ADMIN',
    authenticated: true,
    capabilities: getRoleCapabilities(actor.role as AppRole),
  })),
  getCurrentUser: vi.fn(async () => ({ id: actor.id, tokenVersion: 0, timeZone: 'UTC' })),
}));

const { countPendingApprovals, listMcpApprovals, loadMcpViewer } =
  await import('@/app/(app)/settings/integrations/mcp/queries');

const now = new Date('2026-11-04T12:00:00Z');
let requester: { id: string };
let responder: { id: string };
let reviewer: { id: string };
let grantId: string;

async function plan(
  actorId: string,
  extra: { incidentId?: string; serviceId?: string; rejected?: boolean } = {}
) {
  const runbook = await db.runbook.findFirstOrThrow();
  return db.runbookPreviewAuthorization.create({
    data: {
      id: randomBytes(32).toString('hex'),
      actorId,
      runbookId: runbook.id,
      planDigest: 'a'.repeat(64),
      expiresAt: new Date(now.getTime() + 3600_000),
      independentReview: true,
      requesterGrantId: grantId,
      requesterCredentialId: 'credential',
      incidentId: extra.incidentId ?? null,
      serviceId: extra.serviceId ?? null,
      ...(extra.rejected
        ? {
            rejectedAt: now,
            rejectedById: reviewer.id,
            decisionReason: 'Not during the freeze',
          }
        : {}),
    },
  });
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  await resetDatabase();
}, 60000);

beforeEach(async () => {
  await db.runbookPreviewAuthorization.deleteMany();
  await db.mcpOperationApproval.deleteMany();
  requester = await createTestUser({ role: 'ADMIN', name: 'Rita Requester' });
  responder = await createTestUser({ role: 'RESPONDER', name: 'Rob Responder' });
  reviewer = await createTestUser({ role: 'ADMIN', name: 'Ada Reviewer' });
  const client = await db.mcpClient.create({
    data: { name: 'Claude', redirectUris: [], scopes: ['runbooks:execute'] },
  });
  grantId = (
    await db.mcpGrant.create({
      data: {
        clientId: client.id,
        userId: requester.id,
        userTokenVersion: 0,
        scopes: [],
        resource: 'http://localhost:3000/mcp',
        expiresAt: new Date(now.getTime() + 3600_000),
      },
    })
  ).id;
  if (!(await db.runbook.count()))
    await db.runbook.create({
      data: { name: 'Restart gateway', slug: `restart-${randomBytes(4).toString('hex')}` },
    });
});

describe('C6 approvals queue for runbook approvers who are not administrators', () => {
  it("lists other people's runbook plans for a responder, never their own or changes", async () => {
    await plan(requester.id);
    await plan(responder.id);
    await plan(requester.id, { rejected: true });
    actor.id = responder.id;
    actor.role = 'RESPONDER';
    const viewer = await loadMcpViewer();
    expect(viewer).toMatchObject({
      isAdmin: false,
      canApproveRunbooks: true,
      readsAllTargets: true,
    });

    const pending = await listMcpApprovals(
      viewer,
      { kind: 'runbooks', state: 'pending', page: 1 },
      now
    );
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]).toMatchObject({
      kind: 'runbooks',
      status: 'pending',
      requester: { id: requester.id },
      assistant: 'Claude',
    });
    expect(pending.pending).toEqual({ operations: 0, runbooks: 1, total: 1 });
    expect(await countPendingApprovals(viewer, now)).toEqual({
      operations: 0,
      runbooks: 1,
      total: 1,
    });

    const decided = await listMcpApprovals(
      viewer,
      { kind: 'runbooks', state: 'decided', page: 1 },
      now
    );
    expect(decided.rows).toHaveLength(1);
    expect(decided.rows[0]).toMatchObject({
      status: 'rejected',
      reviewer: { id: reviewer.id, name: 'Ada Reviewer' },
      decisionReason: 'Not during the freeze',
      selfApproved: false,
    });

    await expect(
      listMcpApprovals(viewer, { kind: 'operations', state: 'pending', page: 1 }, now)
    ).rejects.toThrow('MCP_ADMIN_REQUIRED');
  });

  it('keeps the queue closed to people who cannot approve runbooks', async () => {
    await plan(requester.id);
    for (const role of ['USER', 'AUDITOR'] as const) {
      const person = await createTestUser({ role });
      actor.id = person.id;
      actor.role = role;
      const viewer = await loadMcpViewer();
      expect(viewer.canApproveRunbooks).toBe(false);
      await expect(
        listMcpApprovals(viewer, { kind: 'runbooks', state: 'pending', page: 1 }, now)
      ).rejects.toThrow('MCP_ADMIN_REQUIRED');
      await expect(countPendingApprovals(viewer, now)).rejects.toThrow('MCP_ADMIN_REQUIRED');
    }
  });

  it('shows administrators every plan, including self-approved ones in history', async () => {
    const own = await plan(requester.id);
    await db.runbookPreviewAuthorization.update({
      where: { id: own.id },
      data: {
        reviewedById: requester.id,
        reviewerTokenVersion: 0,
        reviewedAt: now,
        reviewedPlanDigest: own.planDigest,
        selfApproved: true,
        consumedAt: now,
      },
    });
    actor.id = reviewer.id;
    actor.role = 'ADMIN';
    const viewer = await loadMcpViewer();
    const decided = await listMcpApprovals(
      viewer,
      { kind: 'runbooks', state: 'decided', page: 1 },
      now
    );
    expect(decided.rows[0]).toMatchObject({ selfApproved: true, reviewer: { id: requester.id } });
  });
});
