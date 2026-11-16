import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { MCP_CATALOG, MCP_OPERATION_MAP } from '../catalog';

/**
 * The per-connection activity log behind the connection drawer. One row per MCP request on a grant,
 * holding bounded labels only: the metrics tool label, an operationId that exactly matches the
 * catalog, the metrics outcome, a duration, the request id and an error code. Never arguments,
 * results or free text. Rows are queued in memory and written in batches, so logging never adds a
 * database round trip to the call it describes; a full queue drops rows and counts them.
 * shortcut: a process that is killed outright loses up to one second of rows, and a batch that
 * fails twice is dropped. AuditLog is the durable record of changes; move this to a table-backed
 * outbox if the activity log ever has to be complete.
 */

/** Default retention; the policy's callLogRetentionDays (7 to 365) overrides it. */
export const MCP_CALL_LOG_DEFAULT_RETENTION_DAYS = 30;
export const MCP_CALL_LOG_RETENTION_MS = MCP_CALL_LOG_DEFAULT_RETENTION_DAYS * 86_400_000;
/** Rows shown per page in the activity drawer. */
export const MCP_CALL_LOG_PAGE_SIZE = 100;

const MAX_QUEUED = 2000;
const FLUSH_AT = 200;
const FLUSH_DELAY_MS = 1000;

export type McpCallLogEntry = {
  grantId: string;
  /** Who made the call, as ids only. Null for rows written before round 6. */
  clientId?: string | null;
  userId?: string | null;
  tool: string;
  operationId: string | null;
  outcome: string;
  durationMs: number;
  requestId: string;
  errorCode: string | null;
  at?: Date;
};

const toolOperations = new Map(
  MCP_CATALOG.flatMap(operation =>
    operation.tool ? [[operation.tool, operation.operationId] as const] : []
  )
);

/**
 * The operation a call ran, or null. A curated tool names its own operation; the generic tools
 * name one in `operationId`, which is kept only when it is exactly a catalog key.
 */
export function mcpCallLogOperationId(tool: string, args: unknown): string | null {
  const curated = toolOperations.get(tool);
  if (curated) return curated;
  const requested =
    args && typeof args === 'object' ? (args as { operationId?: unknown }).operationId : undefined;
  return typeof requested === 'string' && MCP_OPERATION_MAP.has(requested) ? requested : null;
}

const queue: McpCallLogEntry[] = [];
/** The one batch whose write failed and is tried once more with the next flush. */
let retryBatch: McpCallLogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

/** Queues one activity row. Never throws and never waits for the database. */
export function recordMcpCallLog(entry: McpCallLogEntry) {
  if (queue.length >= MAX_QUEUED) {
    addOperationalMetric('opsknight_mcp_call_log_dropped_total', 1);
    return;
  }
  queue.push({
    ...entry,
    durationMs: Math.max(0, Math.min(2_147_483_647, Math.round(entry.durationMs))),
    errorCode: entry.errorCode?.slice(0, 64) ?? null,
    at: entry.at ?? new Date(),
  });
  if (queue.length >= FLUSH_AT) void flushMcpCallLog();
  else if (!timer) {
    timer = setTimeout(() => void flushMcpCallLog(), FLUSH_DELAY_MS);
    timer.unref?.();
  }
}

/** Writes every queued row. A failed batch is retried once with the next flush, then dropped. */
export async function flushMcpCallLog(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing) await flushing;
  if (!queue.length && !retryBatch.length) return;
  const retried = retryBatch;
  const fresh = queue.splice(0, queue.length);
  retryBatch = [];
  flushing = (async () => {
    try {
      await prisma.mcpCallLog.createMany({ data: [...retried, ...fresh] });
    } catch (error) {
      if (retried.length)
        addOperationalMetric('opsknight_mcp_call_log_dropped_total', retried.length);
      retryBatch = fresh;
      if (fresh.length && !timer) {
        timer = setTimeout(() => void flushMcpCallLog(), FLUSH_DELAY_MS);
        timer.unref?.();
      }
      logger.warn('mcp.call_log.write_failed', {
        rows: retried.length + fresh.length,
        dropped: retried.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      flushing = null;
    }
  })();
  await flushing;
}

export function queuedMcpCallLogForTests() {
  return queue.length + retryBatch.length;
}
