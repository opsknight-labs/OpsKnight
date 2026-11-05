import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireMcp } from '@/lib/mcp/core/errors';
import { MCP_PAT_CLIENT_ID } from '@/lib/mcp/auth/effective-access';
import { MCP_CALL_LOG_DEFAULT_RETENTION_DAYS } from '@/lib/mcp/core/call-log';
import type { McpViewer } from './queries';
import { USAGE_GROUPS, USAGE_WINDOW_KEYS, type UsageGroup, type UsageWindow } from './list-params';

export { USAGE_GROUPS, USAGE_WINDOW_KEYS };
export type { UsageGroup, UsageWindow };

/**
 * Fleet-wide MCP usage for administrators, from McpCallLog: calls, failures and p95 latency by
 * tool, client or person, plus a bounded export of the underlying rows. The log holds ids and
 * bounded labels only (never arguments or results), so nothing here can show what anyone asked.
 */

export const USAGE_WINDOWS: Record<UsageWindow, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** Groups shown per view; the rest are summed into the totals only. */
export const USAGE_ROW_LIMIT = 50;
/** Rows in one export. A longer result is cut and says so. */
export const USAGE_EXPORT_LIMIT = 10_000;

/** Outcomes that mean the request did what it was asked to. Everything else counts as a failure. */
const SUCCESS_OUTCOMES = ['served', 'task_created', 'subscription_opened'] as const;
/** Outcomes that reached domain work, so their duration says something about speed. */
const TIMED_OUTCOMES = ['served', 'tool_error', 'task_created', 'result_too_large'] as const;

// A closed set of column names: the group never comes from the request as text.
const GROUP_COLUMN = {
  tool: Prisma.raw('"tool"'),
  client: Prisma.raw('"clientId"'),
  user: Prisma.raw('"userId"'),
} as const;

export type McpUsageRow = {
  /** The tool name, client id or user id; null for calls logged before client and user were recorded. */
  key: string | null;
  label: string;
  calls: number;
  failed: number;
  /** 0 to 1. */
  errorRate: number;
  p95Ms: number | null;
};

export type McpUsage = {
  window: UsageWindow;
  by: UsageGroup;
  since: string;
  rows: McpUsageRow[];
  totals: { calls: number; failed: number; errorRate: number; p95Ms: number | null };
  /** More groups exist than the view shows. */
  truncated: boolean;
  /** Days the log is kept; a window longer than this is incomplete. */
  retentionDays: number;
};

function requireAdmin(viewer: McpViewer) {
  requireMcp(viewer.isAdmin, 'MCP_ADMIN_REQUIRED', 403);
}

/** Free text from the search box, matched against the tool name or exactly against the rest. */
function textFilter(q: string) {
  const text = q.trim().slice(0, 100);
  if (!text) return Prisma.empty;
  const like = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
  return Prisma.sql`AND ("tool" ILIKE ${like} OR "outcome" = ${text} OR "errorCode" = ${text} OR "requestId" = ${text})`;
}

const rate = (failed: number, calls: number) =>
  calls ? Math.round((failed / calls) * 10_000) / 10_000 : 0;

async function labels(by: UsageGroup, keys: string[]) {
  const names = new Map<string, string>();
  if (by === 'client' && keys.length) {
    const clients = await prisma.mcpClient.findMany({
      where: { id: { in: keys } },
      select: { id: true, name: true },
    });
    for (const client of clients) names.set(client.id, client.name);
    if (keys.includes(MCP_PAT_CLIENT_ID)) names.set(MCP_PAT_CLIENT_ID, 'Personal access tokens');
  }
  if (by === 'user' && keys.length) {
    // Names only: an email address is never shown or exported from here.
    const users = await prisma.user.findMany({
      where: { id: { in: keys } },
      select: { id: true, name: true },
    });
    for (const user of users) names.set(user.id, user.name ?? 'Unnamed user');
  }
  return names;
}

export async function getMcpUsage(
  viewer: McpViewer,
  input: { window: UsageWindow; by: UsageGroup; q?: string },
  now = new Date()
): Promise<McpUsage> {
  requireAdmin(viewer);
  const since = new Date(now.getTime() - USAGE_WINDOWS[input.window]);
  const column = GROUP_COLUMN[input.by];
  const where = Prisma.sql`"at" >= ${since} ${textFilter(input.q ?? '')}`;
  const success = Prisma.join(SUCCESS_OUTCOMES);
  const timed = Prisma.join(TIMED_OUTCOMES);

  const [groups, total, policy] = await Promise.all([
    prisma.$queryRaw<
      { key: string | null; calls: bigint; failed: bigint; p95: number | null }[]
    >`SELECT ${column} AS "key",
        COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE "outcome" NOT IN (${success})) AS failed,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
          FILTER (WHERE "outcome" IN (${timed})) AS p95
      FROM "McpCallLog" WHERE ${where}
      GROUP BY 1 ORDER BY calls DESC, "key" ASC NULLS LAST LIMIT ${USAGE_ROW_LIMIT + 1}`,
    prisma.$queryRaw<{ calls: bigint; failed: bigint; p95: number | null }[]>`
      SELECT COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE "outcome" NOT IN (${success})) AS failed,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
          FILTER (WHERE "outcome" IN (${timed})) AS p95
      FROM "McpCallLog" WHERE ${where}`,
    prisma.mcpPolicy.findUnique({
      where: { id: 'default' },
      select: { callLogRetentionDays: true },
    }),
  ]);

  const shown = groups.slice(0, USAGE_ROW_LIMIT);
  const names = await labels(
    input.by,
    shown.flatMap(group => (group.key ? [group.key] : []))
  );
  const fallback = input.by === 'tool' ? '' : 'Not recorded (calls before this was tracked)';
  const totals = total.at(0);
  const calls = Number(totals?.calls ?? 0);
  const failed = Number(totals?.failed ?? 0);
  return {
    window: input.window,
    by: input.by,
    since: since.toISOString(),
    rows: shown.map(group => {
      const callCount = Number(group.calls);
      const failedCount = Number(group.failed);
      return {
        key: group.key,
        label: group.key ? (names.get(group.key) ?? group.key) : fallback,
        calls: callCount,
        failed: failedCount,
        errorRate: rate(failedCount, callCount),
        p95Ms: group.p95 === null ? null : Math.round(Number(group.p95)),
      };
    }),
    totals: {
      calls,
      failed,
      errorRate: rate(failed, calls),
      p95Ms:
        totals?.p95 === null || totals?.p95 === undefined ? null : Math.round(Number(totals.p95)),
    },
    truncated: groups.length > USAGE_ROW_LIMIT,
    retentionDays: policy?.callLogRetentionDays ?? MCP_CALL_LOG_DEFAULT_RETENTION_DAYS,
  };
}

export type McpUsageExportRow = {
  at: string;
  tool: string;
  operationId: string | null;
  outcome: string;
  durationMs: number;
  requestId: string;
  errorCode: string | null;
  clientId: string | null;
  userId: string | null;
  grantId: string;
};
export const USAGE_EXPORT_COLUMNS = [
  'at',
  'tool',
  'operationId',
  'outcome',
  'durationMs',
  'requestId',
  'errorCode',
  'clientId',
  'userId',
  'grantId',
] as const satisfies readonly (keyof McpUsageExportRow)[];

/** The rows behind a view, newest first, cut at USAGE_EXPORT_LIMIT. */
export async function getMcpUsageExportRows(
  viewer: McpViewer,
  input: { window: UsageWindow; q?: string },
  now = new Date()
) {
  requireAdmin(viewer);
  const since = new Date(now.getTime() - USAGE_WINDOWS[input.window]);
  const rows = await prisma.$queryRaw<
    (Omit<McpUsageExportRow, 'at'> & { at: Date })[]
  >`SELECT "at", "tool", "operationId", "outcome", "durationMs", "requestId", "errorCode",
      "clientId", "userId", "grantId"
    FROM "McpCallLog" WHERE "at" >= ${since} ${textFilter(input.q ?? '')}
    ORDER BY "at" DESC, "id" DESC LIMIT ${USAGE_EXPORT_LIMIT + 1}`;
  return {
    rows: rows.slice(0, USAGE_EXPORT_LIMIT).map(row => ({ ...row, at: row.at.toISOString() })),
    truncated: rows.length > USAGE_EXPORT_LIMIT,
  };
}

/**
 * One CSV cell. A value a spreadsheet would read as a formula gets a leading apostrophe, and any
 * value with a comma, quote or line break is quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function usageToCsv(rows: readonly McpUsageExportRow[]): string {
  const lines = [USAGE_EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    const values = new Map(Object.entries(row));
    lines.push(USAGE_EXPORT_COLUMNS.map(name => csvCell(values.get(name))).join(','));
  }
  return `${lines.join('\n')}\n`;
}
