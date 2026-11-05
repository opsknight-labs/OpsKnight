import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/** "Last call" on a connection is written at most this often per grant. */
export const MCP_LAST_CALL_INTERVAL_MS = 60_000;
const TRACKED_GRANTS = 10_000;
const written = new Map<string, number>();

/**
 * Record that a connection made a tool call, for the "Last call" column. Throttled in memory per
 * process and in the database across processes, so a busy assistant costs one write a minute.
 * `tool` is the bounded metrics label (named tools, "other" or "none"), never an argument.
 * A failure is logged and never fails the call it describes.
 */
export async function recordMcpGrantCall(grantId: string, tool: string, now = Date.now()) {
  const previous = written.get(grantId);
  if (previous !== undefined && now - previous < MCP_LAST_CALL_INTERVAL_MS) return;
  written.delete(grantId);
  if (written.size >= TRACKED_GRANTS) written.delete(written.keys().next().value!);
  written.set(grantId, now);
  try {
    await prisma.mcpGrant.updateMany({
      where: {
        id: grantId,
        OR: [
          { lastCallAt: null },
          { lastCallAt: { lt: new Date(now - MCP_LAST_CALL_INTERVAL_MS) } },
        ],
      },
      data: { lastCallAt: new Date(now), lastTool: tool },
    });
  } catch (error) {
    logger.warn('mcp.grant.last_call_failed', {
      grantId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

export function resetMcpUsageForTests() {
  written.clear();
}
