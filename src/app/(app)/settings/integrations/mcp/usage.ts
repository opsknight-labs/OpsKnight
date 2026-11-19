import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireMcp } from '@/lib/mcp/core/errors';
import { MCP_PAT_CLIENT_ID } from '@/lib/mcp/auth/effective-access';
import { MCP_CALL_LOG_DEFAULT_RETENTION_DAYS } from '@/lib/mcp/core/call-log';
import type { McpViewer } from './queries';
import { resolveUsageRange } from './usage-range';
import {
  USAGE_GROUPS,
  USAGE_PAGE_SIZE,
  USAGE_WINDOW_KEYS,
  type UsageGroup,
  type UsageWindow,
} from './list-params';

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
  /** The page shown (1-based; clamped to the last page) and how many groups exist in all. */
  page: number;
  groupCount: number;
  /** Days the log is kept; a window longer than this is incomplete. */
  retentionDays: number;
  /** End of the period shown (now, or the end of a custom range). */
  until: string;
  /** The custom date range in force, or null when a preset window is shown. */
  range: { from: string; to: string } | null;
  /** Why the requested custom range was refused; the preset window is shown instead. */
  rangeError: string | null;
  /** Calls and failures per hour (periods up to two days) or per UTC day, oldest first. */
  bucket: 'hour' | 'day';
  series: { at: string; calls: number; failed: number }[];
  /** The most frequent failures, by error code and outcome. */
  errorCodes: { code: string | null; outcome: string; count: number }[];
};

/** Kinds of failure listed in the breakdown. */
export const USAGE_ERROR_CODE_LIMIT = 10;

type UsagePeriodInput = { window: UsageWindow; from?: string | null; to?: string | null };

async function usageRetentionDays() {
  const policy = await prisma.mcpPolicy.findUnique({
    where: { id: 'default' },
    select: { callLogRetentionDays: true },
  });
  return policy?.callLogRetentionDays ?? MCP_CALL_LOG_DEFAULT_RETENTION_DAYS;
}

/** The period a view covers: a valid custom range, else the preset window ending now. */
export function usagePeriod(input: UsagePeriodInput, retentionDays: number, now: Date) {
  const preset = {
    since: new Date(now.getTime() - USAGE_WINDOWS[input.window]),
    until: now,
    range: null,
  };
  if (!input.from && !input.to) return { ...preset, rangeError: null };
  const range = resolveUsageRange(input.from ?? '', input.to ?? '', retentionDays, now);
  return range.ok
    ? {
        since: range.since,
        until: range.until,
        range: { from: range.from, to: range.to },
        rangeError: null,
      }
    : { ...preset, rangeError: range.error };
}

const HOUR = 3_600_000;

/** Every bucket in the period, empty ones as zero, so the chart's x axis is true to time. */
export function fillUsageSeries(
  rows: readonly { bucket: Date; calls: number; failed: number }[],
  since: Date,
  until: Date,
  bucket: 'hour' | 'day'
) {
  const step = bucket === 'hour' ? HOUR : 24 * HOUR;
  const found = new Map(rows.map(row => [row.bucket.getTime(), row]));
  const series: McpUsage['series'] = [];
  for (let at = Math.floor(since.getTime() / step) * step; at < until.getTime(); at += step) {
    const row = found.get(at);
    series.push({
      at: new Date(at).toISOString(),
      calls: row?.calls ?? 0,
      failed: row?.failed ?? 0,
    });
  }
  return series;
}

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

/**
 * What a row is called. The request log records "none" for requests that are not a tool call
 * (initialize, tools/list, ping, rate-limited requests), which reads as a bug, so it is named. A
 * person or assistant that has since been removed shows a short id instead of nothing.
 */
export function usageLabel(
  by: 'tool' | 'client' | 'user',
  key: string | null,
  names: ReadonlyMap<string, string>,
  fallback: string
) {
  if (!key) return fallback;
  if (by === 'tool')
    return key === 'none' ? 'Protocol requests (initialize, tools/list, ping)' : key;
  return (
    names.get(key) ??
    `Removed ${by === 'user' ? 'person' : 'assistant'} (id ending ${key.slice(-6)})`
  );
}

export async function getMcpUsage(
  viewer: McpViewer,
  input: UsagePeriodInput & {
    by: UsageGroup;
    q?: string;
    page?: number;
    /** Only this assistant's calls (the assistant detail page). */
    clientId?: string;
  },
  now = new Date()
): Promise<McpUsage> {
  requireAdmin(viewer);
  const retentionDays = await usageRetentionDays();
  const { since, until, range, rangeError } = usagePeriod(input, retentionDays, now);
  const column = GROUP_COLUMN[input.by];
  const client = input.clientId ? Prisma.sql`AND "clientId" = ${input.clientId}` : Prisma.empty;
  const where = Prisma.sql`"at" >= ${since} AND "at" < ${until} ${client} ${textFilter(input.q ?? '')}`;
  const success = Prisma.join(SUCCESS_OUTCOMES);
  const timed = Prisma.join(TIMED_OUTCOMES);
  const bucket = until.getTime() - since.getTime() <= 2 * 24 * HOUR ? 'hour' : 'day';
  // A closed set: the unit never comes from the request as text.
  const unit = Prisma.raw(bucket === 'hour' ? "'hour'" : "'day'");

  const page = Math.max(1, Math.floor(input.page ?? 1));
  const [groups, total, buckets, errorCodes] = await Promise.all([
    prisma.$queryRaw<
      {
        key: string | null;
        calls: bigint;
        failed: bigint;
        p95: number | null;
        groupCount: bigint;
      }[]
    >`SELECT ${column} AS "key",
        COUNT(*) OVER () AS "groupCount",
        COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE "outcome" NOT IN (${success})) AS failed,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
          FILTER (WHERE "outcome" IN (${timed})) AS p95
      FROM "McpCallLog" WHERE ${where}
      GROUP BY 1 ORDER BY calls DESC, "key" ASC NULLS LAST
      LIMIT ${USAGE_PAGE_SIZE} OFFSET ${(page - 1) * USAGE_PAGE_SIZE}`,
    prisma.$queryRaw<{ calls: bigint; failed: bigint; p95: number | null }[]>`
      SELECT COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE "outcome" NOT IN (${success})) AS failed,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")
          FILTER (WHERE "outcome" IN (${timed})) AS p95
      FROM "McpCallLog" WHERE ${where}`,
    prisma.$queryRaw<{ bucket: Date; calls: bigint; failed: bigint }[]>`
      SELECT date_trunc(${unit}, "at") AS bucket, COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE "outcome" NOT IN (${success})) AS failed
      FROM "McpCallLog" WHERE ${where}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ code: string | null; outcome: string; count: bigint }[]>`
      SELECT "errorCode" AS code, "outcome", COUNT(*) AS count
      FROM "McpCallLog" WHERE ${where} AND "outcome" NOT IN (${success})
      GROUP BY 1, 2 ORDER BY count DESC, code ASC NULLS LAST, "outcome" ASC
      LIMIT ${USAGE_ERROR_CODE_LIMIT}`,
  ]);

  // A page past the end (a stale link after the window shrank) shows the first page instead.
  if (groups.length === 0 && page > 1) return getMcpUsage(viewer, { ...input, page: 1 }, now);
  const shown = groups;
  const groupCount = Number(groups.at(0)?.groupCount ?? 0);
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
    until: until.toISOString(),
    range,
    rangeError,
    rows: shown.map(group => {
      const callCount = Number(group.calls);
      const failedCount = Number(group.failed);
      return {
        key: group.key,
        label: usageLabel(input.by, group.key, names, fallback),
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
    page,
    groupCount,
    retentionDays,
    bucket,
    series: fillUsageSeries(
      buckets.map(row => ({
        bucket: row.bucket,
        calls: Number(row.calls),
        failed: Number(row.failed),
      })),
      since,
      until,
      bucket
    ),
    errorCodes: errorCodes.map(row => ({
      code: row.code,
      outcome: row.outcome,
      count: Number(row.count),
    })),
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
  input: UsagePeriodInput & { q?: string },
  now = new Date()
) {
  requireAdmin(viewer);
  const { since, until, range, rangeError } = usagePeriod(input, await usageRetentionDays(), now);
  // An export never silently widens to another period than the one asked for.
  requireMcp(!rangeError, 'MCP_INVALID_USAGE_RANGE', 400, rangeError ?? undefined);
  const rows = await prisma.$queryRaw<
    (Omit<McpUsageExportRow, 'at'> & { at: Date })[]
  >`SELECT "at", "tool", "operationId", "outcome", "durationMs", "requestId", "errorCode",
      "clientId", "userId", "grantId"
    FROM "McpCallLog" WHERE "at" >= ${since} AND "at" < ${until} ${textFilter(input.q ?? '')}
    ORDER BY "at" DESC, "id" DESC LIMIT ${USAGE_EXPORT_LIMIT + 1}`;
  return {
    rows: rows.slice(0, USAGE_EXPORT_LIMIT).map(row => ({ ...row, at: row.at.toISOString() })),
    truncated: rows.length > USAGE_EXPORT_LIMIT,
    range,
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
