import 'server-only';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { requireMcp } from '@/lib/mcp/core/errors';
import { MCP_CALL_LOG_PAGE_SIZE } from '@/lib/mcp/core/call-log';
import type { McpViewer } from './queries';

/**
 * One connection's activity for the connection drawer: its recent MCP requests (bounded labels
 * from McpCallLog) and the changes it made (audit rows recorded under the grant's API client id).
 * Only the connection's owner or an administrator may read it; anyone else gets "not found".
 */

export const MCP_ACTIVITY_CHANGES_LIMIT = 25;

const cursorSchema = z
  .object({ at: z.string().datetime(), id: z.string().min(1).max(64) })
  .strict();
export const connectionActivityInputSchema = z
  .object({ grantId: z.string().min(1).max(64), cursor: cursorSchema.optional() })
  .strict();

export type McpActivityCall = {
  id: string;
  at: string;
  tool: string;
  operationId: string | null;
  outcome: string;
  durationMs: number;
  requestId: string;
  errorCode: string | null;
};
export type McpActivityChange = {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
};
export type McpConnectionActivity = {
  calls: McpActivityCall[];
  /** Pass back as `cursor` for the next, older page; null on the last page. */
  next: { at: string; id: string } | null;
  /** Only on the first page. */
  changes: McpActivityChange[];
  /** Administrators: the full change history in API activity, filtered to this connection. */
  historyHref: string | null;
};

export async function listMcpConnectionActivity(
  viewer: McpViewer,
  raw: unknown
): Promise<McpConnectionActivity> {
  const input = connectionActivityInputSchema.parse(raw);
  const grant = await prisma.mcpGrant.findUnique({
    where: { id: input.grantId },
    select: { id: true, userId: true },
  });
  requireMcp(
    grant && (viewer.isAdmin || grant.userId === viewer.id),
    'MCP_RESOURCE_UNAVAILABLE',
    404
  );
  const cursor = input.cursor ? { at: new Date(input.cursor.at), id: input.cursor.id } : null;
  const rows = await prisma.mcpCallLog.findMany({
    where: {
      grantId: grant.id,
      ...(cursor
        ? { OR: [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: MCP_CALL_LOG_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, MCP_CALL_LOG_PAGE_SIZE);
  const last = page.at(-1);
  const apiClientId = `mcp:${grant.id}`;
  const changes = cursor
    ? []
    : await prisma.auditLog.findMany({
        where: {
          actorId: grant.userId,
          OR: [
            { details: { path: ['metadata', 'apiClientId'], equals: apiClientId } },
            { details: { path: ['apiClientId'], equals: apiClientId } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MCP_ACTIVITY_CHANGES_LIMIT,
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
      });
  return {
    calls: page.map(row => ({
      id: row.id,
      at: row.at.toISOString(),
      tool: row.tool,
      operationId: row.operationId,
      outcome: row.outcome,
      durationMs: row.durationMs,
      requestId: row.requestId,
      errorCode: row.errorCode,
    })),
    next:
      rows.length > MCP_CALL_LOG_PAGE_SIZE && last
        ? { at: last.at.toISOString(), id: last.id }
        : null,
    changes: changes.map(row => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
    })),
    historyHref: viewer.isAdmin
      ? `/settings/api-keys?${new URLSearchParams({ tab: 'activity', key: apiClientId })}`
      : null,
  };
}
