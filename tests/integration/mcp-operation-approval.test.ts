import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { encrypt } from '@/lib/encryption';
import { mcpResource } from '@/lib/mcp/auth/config';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  commitApprovedMcpOperation,
  getMcpOperationApproval,
  loadMcpOperationReview,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';
import { POST } from '@/app/mcp/route';

import { approvedLead, connect, fixture, type Fixture } from '../helpers/mcp-approval';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_TOKEN_HASH_SECRET = randomBytes(32).toString('hex');
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, writesEnabled: true, requestsPerMinute: 600 },
    update: { enabled: true, writesEnabled: true, requestsPerMinute: 600 },
  });
});

const announcements = (f: Fixture) =>
  db.statusPageAnnouncement.count({ where: { statusPageId: f.page.id } });

describe('independently approved sensitive MCP operations', () => {
  it('freezes, independently approves and commits a revision-bound change exactly once', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    expect(prepared).toMatchObject({ status: 'REQUIRES_NATIVE_APPROVAL' });
    expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: null,
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_REQUIRED');
    await f.review(prepared);
    const committed = await commitApprovedMcpOperation(f.ctx(), {
      approvalId: prepared.approvalId,
    });
    expect(committed).toMatchObject({ status: 'COMMITTED' });
    expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: f.lead.id,
    });
    const row = await db.mcpOperationApproval.findUniqueOrThrow({
      where: { id: prepared.approvalId },
    });
    expect(row).toMatchObject({
      status: 'COMMITTED',
      envelope: null,
      reviewedById: f.reviewer.id,
      actorId: f.user.id,
    });
    const revision = await f.teamRevision();
    const replay = await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(replay).toMatchObject({ status: 'COMMITTED', replayed: true });
    expect(await f.teamRevision()).toBe(revision);
    const audits = await db.auditLog.findMany({
      where: { entityId: prepared.approvalId },
      select: { action: true },
    });
    expect(audits.map(entry => entry.action).sort()).toEqual([
      'mcp.operation.approved',
      'mcp.operation.committed',
      'mcp.operation.prepared',
    ]);
  });

  it('is not callable through generic dispatch or as a non-gated operation', async () => {
    const f = await fixture();
    await expect(
      callMcpOperation(f.ctx(), 'setTeamLead', {
        path: { id: f.team.id },
        body: { userId: f.lead.id },
        idempotencyKey: 'generic-dispatch-key-1',
        ifMatch: `"${await f.teamRevision()}"`,
      })
    ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
    await expect(
      prepareMcpOperation(f.ctx(), {
        operationId: 'getTeam',
        args: { path: { id: f.team.id } },
        idempotencyKey: 'prepare-read-operation-1',
      })
    ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
    await expect(
      prepareMcpOperation(f.ctx(), {
        operationId: 'archiveRunbook',
        args: { path: { id: 'x' } },
        idempotencyKey: 'prepare-ungated-operation',
      })
    ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  it('rejects invalid arguments and caller-selected idempotency before freezing', async () => {
    const f = await fixture();
    const input = await f.leadArgs();
    const before = await db.mcpOperationApproval.count();
    await expect(
      prepareMcpOperation(f.ctx(), { ...input, args: { ...input.args, extra: true } })
    ).rejects.toThrow('MCP_INVALID_ARGUMENTS');
    await expect(
      prepareMcpOperation(f.ctx(), {
        ...input,
        args: { ...input.args, idempotencyKey: 'caller-supplied-key-123' },
      })
    ).rejects.toThrow('MCP_INVALID_ARGUMENTS');
    await expect(
      prepareMcpOperation(f.ctx(), {
        ...input,
        args: { path: input.args.path, body: input.args.body },
      })
    ).rejects.toThrow('MCP_INVALID_ARGUMENTS');
    expect(await db.mcpOperationApproval.count()).toBe(before);
  });

  it('keeps prepare retryable and bounds an agent from flooding reviewers', async () => {
    const f = await fixture();
    const input = f.announcementArgs();
    const first = await prepareMcpOperation(f.ctx(), input);
    const again = await prepareMcpOperation(f.ctx(), input);
    expect(again.approvalId).toBe(first.approvalId);
    await expect(
      prepareMcpOperation(f.ctx(), { ...input, args: f.announcementArgs('Different').args })
    ).rejects.toThrow();
    for (let index = 1; index < 20; index++)
      await prepareMcpOperation(f.ctx(), f.announcementArgs(`Notice ${index}`));
    await expect(prepareMcpOperation(f.ctx(), f.announcementArgs('Overflow'))).rejects.toThrow(
      'MCP_APPROVAL_BACKLOG'
    );
  });

  it('never lets the requester or an unauthorized user approve', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await expect(f.review(prepared, 'approve', f.user)).rejects.toThrow(
      'MCP_DISTINCT_REVIEWER_REQUIRED'
    );
    const ordinary = await createTestUser({ role: 'USER' });
    await expect(f.review(prepared, 'approve', ordinary)).rejects.toThrow(
      'MCP_REVIEWER_NOT_AUTHORIZED'
    );
    await expect(
      f.review(prepared, 'approve', {
        id: f.reviewer.id,
        tokenVersion: f.reviewer.tokenVersion + 1,
      })
    ).rejects.toThrow('MCP_REVIEWER_CHANGED');
    await expect(
      loadMcpOperationReview(prepared.approvalId, {
        id: f.user.id,
        tokenVersion: f.user.tokenVersion,
      })
    ).rejects.toThrow('MCP_DISTINCT_REVIEWER_REQUIRED');
    expect(
      (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: prepared.approvalId } }))
        .status
    ).toBe('PENDING');
    await expect(
      db.mcpOperationApproval.update({
        where: { id: prepared.approvalId },
        data: {
          status: 'APPROVED',
          reviewedById: f.user.id,
          reviewerTokenVersion: 0,
          reviewedAt: new Date(),
        },
      })
    ).rejects.toThrow();
  });

  it('rejects a mismatched digest and a rejected or expired plan', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await expect(f.review({ ...prepared, operationDigest: 'a'.repeat(64) })).rejects.toThrow(
      'MCP_APPROVAL_PLAN_CHANGED'
    );
    await f.review(prepared, 'reject');
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_REJECTED');
    await expect(f.review(prepared)).rejects.toThrow('MCP_APPROVAL_EXPIRED');

    const second = await prepareMcpOperation(f.ctx(), await f.leadArgs());
    await db.mcpOperationApproval.update({
      where: { id: second.approvalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(f.review(second)).rejects.toThrow('MCP_APPROVAL_EXPIRED');
    const third = await approvedLead(f);
    await db.mcpOperationApproval.update({
      where: { id: third.approvalId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: third.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_EXPIRED');
    expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: null,
    });
  });

  it('fails closed when the frozen envelope no longer matches its digest', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const tampered = {
      path: { id: f.team.id },
      body: { userId: f.user.id },
      ifMatch: `"${await f.teamRevision()}"`,
    };
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: { envelope: await encrypt(JSON.stringify(tampered)) },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');
    expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: null,
    });
  });

  it('rejects a stale target revision and ends that approval', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    await db.team.update({ where: { id: f.team.id }, data: { description: 'changed elsewhere' } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: null,
    });
    expect(
      await getMcpOperationApproval(f.ctx(), { approvalId: prepared.approvalId })
    ).toMatchObject({ status: 'FAILED' });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).resolves.toMatchObject({ status: 'FAILED', replayed: true });
  });

  it('rechecks reviewer and requester authority at commit', async () => {
    const reviewerLoses = await fixture();
    const first = await approvedLead(reviewerLoses);
    await db.user.update({
      where: { id: reviewerLoses.reviewer.id },
      data: { role: 'USER' },
    });
    await expect(
      commitApprovedMcpOperation(reviewerLoses.ctx(), { approvalId: first.approvalId })
    ).rejects.toThrow('MCP_REVIEWER_NOT_AUTHORIZED');
    expect(await db.team.findUnique({ where: { id: reviewerLoses.team.id } })).toMatchObject({
      teamLeadId: null,
    });

    const reviewerDeactivated = await fixture();
    const second = await approvedLead(reviewerDeactivated);
    await db.user.update({
      where: { id: reviewerDeactivated.reviewer.id },
      data: { tokenVersion: { increment: 1 } },
    });
    await expect(
      commitApprovedMcpOperation(reviewerDeactivated.ctx(), { approvalId: second.approvalId })
    ).rejects.toThrow('MCP_REVIEWER_CHANGED');

    const requesterLoses = await fixture();
    const third = await approvedLead(requesterLoses);
    await db.mcpGrant.update({
      where: { id: requesterLoses.grant.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      commitApprovedMcpOperation(requesterLoses.ctx(), { approvalId: third.approvalId })
    ).rejects.toThrow('MCP_INVALID_GRANT');

    const demoted = await fixture();
    const fourth = await approvedLead(demoted);
    await db.user.update({ where: { id: demoted.user.id }, data: { role: 'USER' } });
    await expect(
      commitApprovedMcpOperation(demoted.ctx(), { approvalId: fourth.approvalId })
    ).rejects.toThrow();
    expect(await db.team.findUnique({ where: { id: demoted.team.id } })).toMatchObject({
      teamLeadId: null,
    });
  });

  it('treats the approval id as no authority for another grant', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const other = await connect(f.user.id, f.user.tokenVersion);
    await expect(
      commitApprovedMcpOperation(other.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_UNAVAILABLE');
    await expect(
      getMcpOperationApproval(other.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_UNAVAILABLE');
    const intruder = await createTestUser({ role: 'ADMIN' });
    const stranger = await connect(intruder.id, intruder.tokenVersion);
    await expect(
      commitApprovedMcpOperation(stranger.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_UNAVAILABLE');
  });

  it('keeps writes disabled by policy from committing an approved plan', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_OPERATION_DISABLED');
    expect(await db.team.findUnique({ where: { id: f.team.id } })).toMatchObject({
      teamLeadId: null,
    });
  });

  it('applies a concurrent commit once', async () => {
    const f = await fixture();
    const prepared = await prepareMcpOperation(f.ctx(), f.announcementArgs());
    await f.review(prepared);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
      )
    );
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(await announcements(f)).toBe(1);
    const final = await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(final).toMatchObject({ status: 'COMMITTED' });
    expect(await announcements(f)).toBe(1);
  });

  it('recovers an ambiguous outcome without repeating the effect', async () => {
    const f = await fixture();
    const input = f.announcementArgs();
    const prepared = await prepareMcpOperation(f.ctx(), input);
    await f.review(prepared);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(await announcements(f)).toBe(1);
    // Simulate a crash after the domain commit but before the approval row was finalized.
    const frozen = { path: input.args.path, body: input.args.body };
    await db.mcpOperationApproval.update({
      where: { id: prepared.approvalId },
      data: {
        status: 'EXECUTING',
        executingAt: new Date(),
        committedAt: null,
        outcome: undefined,
        envelope: await encrypt(JSON.stringify(frozen)),
      },
    });
    const recovered = await commitApprovedMcpOperation(f.ctx(), {
      approvalId: prepared.approvalId,
    });
    expect(recovered).toMatchObject({ status: 'COMMITTED' });
    expect(await announcements(f)).toBe(1);
  });

  it('commits an announcement and a revision-bound support-hours change', async () => {
    const f = await fixture();
    const announcement = await prepareMcpOperation(f.ctx(), f.announcementArgs());
    expect(JSON.stringify(announcement.summary)).toContain('Reviewed message');
    await f.review(announcement);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: announcement.approvalId });
    expect(await announcements(f)).toBe(1);

    const service = await createTestService('Support hours');
    const hours = await prepareMcpOperation(f.ctx(), {
      operationId: 'updateServiceSupportHours',
      args: {
        path: { id: service.id },
        body: {
          timezone: 'UTC',
          inheritWorkspace: false,
          mode: 'ALWAYS',
          windows: [],
          exceptions: [],
        },
        ifMatch: '"0"',
      },
      idempotencyKey: 'support-hours-prepare-1',
    });
    await f.review(hours);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: hours.approvalId });
    expect(
      await db.responseSupportHoursPolicy.count({ where: { scopeKey: `service:${service.id}` } })
    ).toBeGreaterThan(0);
  });

  it('withholds secret-like fields from the review summary but still binds them', async () => {
    const f = await fixture();
    const input = f.announcementArgs();
    const prepared = await prepareMcpOperation(f.ctx(), {
      ...input,
      args: {
        ...input.args,
        body: { ...input.args.body, message: 'Bearer abcdefghijklmnop123456 visible?' },
      },
    });
    expect(JSON.stringify(prepared.summary)).not.toContain('abcdefghijklmnop123456');
    expect(prepared.operationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('exposes the workflow tools only with writes enabled and authority', async () => {
    const f = await fixture();
    const list = async (bearer: string) => {
      const response = await POST(
        new Request(mcpResource(), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/list',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': { name: 'approval-test', version: '1' },
              },
            },
          }),
        })
      );
      expect(response.status).toBe(200);
      return ((await response.json()).result.tools as { name: string }[]).map(tool => tool.name);
    };
    expect(await list(f.bearer)).toEqual(
      expect.arrayContaining([
        'operation_prepare',
        'operation_get_approval',
        'operation_commit_approved',
      ])
    );
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { writesEnabled: false } });
    expect(await list(f.bearer)).not.toContain('operation_prepare');
  });
});
