import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { resolveReviewerNotices } from '../approvals/notify';
import { MCP_CALL_LOG_RETENTION_MS } from '../core/call-log';

/** Registrations never used to sign in are kept this long; registration evicts earlier when full. */
export const UNUSED_REGISTRATION_TTL_MS = 30 * 86_400_000;

/** Rows touched per table per tick; the scheduler runs again soon enough to catch up. */
export const MCP_CLEANUP_BATCH = 500;

/**
 * Finished approvals (committed, rejected or expired) are deleted this long after they were
 * requested. The mcp.operation.* audit events stay as the durable record.
 */
export const MCP_APPROVAL_RETENTION_MS = 90 * 86_400_000;

/**
 * Closes out approvals that lapsed without being used: marks them EXPIRED, drops the encrypted
 * frozen request and records the terminal event once. Executing rows are left to commit and
 * failure reconciliation. Rows locked by a concurrent decision or commit are skipped this tick.
 */
export async function expireMcpApprovals(now = new Date()) {
  const operations = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; actorId: string; operationId: string }[]>`
      SELECT id, "actorId", "operationId" FROM "McpOperationApproval"
      WHERE status IN ('PENDING', 'APPROVED') AND "expiresAt" < ${now}
      ORDER BY "expiresAt" ASC, id ASC LIMIT ${MCP_CLEANUP_BATCH} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return 0;
    const updated = await tx.mcpOperationApproval.updateMany({
      where: {
        id: { in: rows.map(row => row.id) },
        status: { in: ['PENDING', 'APPROVED'] },
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED', envelope: null },
    });
    await resolveReviewerNotices(
      tx,
      rows.map(row => row.id),
      'expire',
      now
    );
    for (const row of rows)
      await logAudit(
        {
          source: 'BACKGROUND',
          action: 'mcp.operation.expired',
          entityType: 'SYSTEM_CONFIG',
          entityId: row.id,
          actorId: row.actorId,
          details: { operationId: row.operationId },
        },
        tx
      );
    return updated.count;
  });
  // Runbook previews have no status column: a lapsed, unused plan only loses its frozen request.
  const runbooks = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; actorId: string; runbookId: string }[]>`
      SELECT id, "actorId", "runbookId" FROM "RunbookPreviewAuthorization"
      WHERE "independentReview" AND "consumedAt" IS NULL AND "requestEnvelope" IS NOT NULL
        AND "expiresAt" < ${now}
      ORDER BY "expiresAt" ASC, id ASC LIMIT ${MCP_CLEANUP_BATCH} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return 0;
    const updated = await tx.runbookPreviewAuthorization.updateMany({
      where: { id: { in: rows.map(row => row.id) }, consumedAt: null, expiresAt: { lt: now } },
      data: { requestEnvelope: null },
    });
    await resolveReviewerNotices(
      tx,
      rows.map(row => row.id),
      'expire',
      now
    );
    for (const row of rows)
      await logAudit(
        {
          source: 'BACKGROUND',
          action: 'mcp.runbook.expired',
          entityType: 'RUNBOOK',
          entityId: row.runbookId,
          actorId: row.actorId,
          details: { previewId: row.id },
        },
        tx
      );
    return updated.count;
  });
  return { operations, runbooks };
}

/**
 * Deletes one batch of finished approvals older than the retention window. Open and executing
 * rows are never selected; rows locked by a concurrent reconcile are skipped this tick.
 */
export async function purgeFinishedMcpApprovals(now = new Date()) {
  const before = new Date(now.getTime() - MCP_APPROVAL_RETENTION_MS);
  const finished = ['COMMITTED', 'REJECTED', 'EXPIRED'];
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "McpOperationApproval"
      WHERE status IN (${Prisma.join(finished)}) AND "createdAt" < ${before}
      ORDER BY "createdAt" ASC, id ASC LIMIT ${MCP_CLEANUP_BATCH} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return 0;
    const deleted = await tx.mcpOperationApproval.deleteMany({
      where: {
        id: { in: rows.map(row => row.id) },
        status: { in: finished },
        createdAt: { lt: before },
      },
    });
    return deleted.count;
  });
}

/** Deletes one batch of activity rows older than the activity retention window. */
export async function purgeMcpCallLog(now = new Date()) {
  const before = new Date(now.getTime() - MCP_CALL_LOG_RETENTION_MS);
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "McpCallLog" WHERE "at" < ${before}
      ORDER BY "at" ASC, id ASC LIMIT ${MCP_CLEANUP_BATCH} FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return 0;
    const deleted = await tx.mcpCallLog.deleteMany({
      where: { id: { in: rows.map(row => row.id) }, at: { lt: before } },
    });
    return deleted.count;
  });
}

/** Bounded maintenance on the existing scheduler; no new queue or worker. */
export async function cleanupMcpCredentials() {
  const now = new Date();
  // Keep spent credentials for seven days so replay detection survives rotation.
  const cutoff = new Date(now.getTime() - 7 * 86400000);
  const [consents, grants, tokens, codes] = await Promise.all([
    prisma.mcpConsentRequest.findMany({
      where: { expiresAt: { lt: cutoff } },
      take: 500,
      orderBy: { expiresAt: 'asc' },
      select: { id: true },
    }),
    prisma.mcpGrant.findMany({
      where: { expiresAt: { lt: cutoff } },
      take: 500,
      orderBy: { expiresAt: 'asc' },
      select: { id: true },
    }),
    // Spent tokens: rotated, or past refresh expiry, for longer than the replay window.
    prisma.mcpToken.findMany({
      where: { OR: [{ rotatedAt: { lt: cutoff } }, { refreshExpiresAt: { lt: cutoff } }] },
      take: MCP_CLEANUP_BATCH,
      select: { id: true },
    }),
    prisma.mcpAuthorizationCode.findMany({
      where: { expiresAt: { lt: cutoff } },
      take: MCP_CLEANUP_BATCH,
      orderBy: { expiresAt: 'asc' },
      select: { hash: true },
    }),
  ]);
  const removed = await prisma.$transaction([
    prisma.mcpConsentRequest.deleteMany({
      where: { id: { in: consents.map(item => item.id) }, expiresAt: { lt: cutoff } },
    }),
    prisma.mcpGrant.deleteMany({
      where: { id: { in: grants.map(item => item.id) }, expiresAt: { lt: cutoff } },
    }),
    prisma.mcpToken.deleteMany({
      where: {
        id: { in: tokens.map(item => item.id) },
        OR: [{ rotatedAt: { lt: cutoff } }, { refreshExpiresAt: { lt: cutoff } }],
      },
    }),
    prisma.mcpAuthorizationCode.deleteMany({
      where: { hash: { in: codes.map(item => item.hash) }, expiresAt: { lt: cutoff } },
    }),
  ]);
  const expired = await expireMcpApprovals(now);
  const purgedApprovals = await purgeFinishedMcpApprovals(now);
  const purgedCallLog = await purgeMcpCallLog(now);
  // Expire only registrations never used to sign in. Assistants cache their client_id, so one
  // removed too soon turns a single failed sign-in into a permanent "unknown client".
  const unusedBefore = new Date(now.getTime() - UNUSED_REGISTRATION_TTL_MS);
  const clients = await prisma.mcpClient.findMany({
    where: {
      dynamicRegistration: true,
      firstAuthorizedAt: null,
      createdAt: { lt: unusedBefore },
      grants: { none: {} },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 500,
    select: { id: true },
  });
  const registrations = clients.length
    ? await prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "McpClient"
      WHERE id IN (${Prisma.join(clients.map(client => client.id))}) ORDER BY id FOR UPDATE SKIP LOCKED`;
        // Authorization creates consent under a shared client lock, so this snapshot cannot
        // race a new consent insertion between the check and deletion.
        const pending = await tx.mcpConsentRequest.findMany({
          where: {
            clientId: { in: locked.map(client => client.id) },
            consumedAt: null,
            expiresAt: { gt: now },
          },
          select: { clientId: true },
        });
        const inUse = new Set(pending.map(consent => consent.clientId));
        return tx.mcpClient.deleteMany({
          where: {
            id: { in: locked.filter(client => !inUse.has(client.id)).map(client => client.id) },
            dynamicRegistration: true,
            firstAuthorizedAt: null,
            createdAt: { lt: unusedBefore },
            grants: { none: {} },
          },
        });
      })
    : { count: 0 };
  return {
    consents: removed[0].count,
    grants: removed[1].count,
    tokens: removed[2].count,
    codes: removed[3].count,
    expiredApprovals: expired.operations,
    expiredRunbookPlans: expired.runbooks,
    purgedApprovals,
    purgedCallLog,
    registrations: registrations.count,
  };
}
