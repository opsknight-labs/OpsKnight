import 'server-only';
import { Prisma } from '@prisma/client';
import { InMemoryServerEventBus } from '@modelcontextprotocol/server';
import prisma from '@/lib/prisma';
import { withMcpDatabase } from '@/lib/database-workload';
import { logger } from '@/lib/logger';
import { setOperationalGauge } from '@/lib/metrics/operational/registry';
import { requireMcp } from '../core/errors';

export const MAX_RESOURCE_SUBSCRIPTIONS = 5;
export const MAX_STREAMS_PER_PROCESS = 32;
export const MAX_STREAMS_PER_GRANT = 2;
export const STREAM_LIFETIME_MS = 10 * 60_000;
const timing = { revalidateMs: 30_000 };
export const revalidateIntervalMs = () => timing.revalidateMs;
const POLL_INTERVAL_MS = 5_000;

// Static allowlist: a URI can only select one of these tables and a validated id.
const TABLES = {
  incidents: { table: Prisma.sql`"Incident"`, read: 'getIncident' },
  services: { table: Prisma.sql`"Service"`, read: 'getService' },
  schedules: { table: Prisma.sql`"OnCallSchedule"`, read: 'getSchedule' },
  runbooks: { table: Prisma.sql`"Runbook"`, read: 'getRunbook' },
  reports: { table: Prisma.sql`"SavedReport"`, read: 'getSavedReport' },
  postmortems: { table: Prisma.sql`"Postmortem"`, read: 'getPostmortem' },
} as const;
type Domain = keyof typeof TABLES;
const URI =
  /^opsknight:\/\/(incidents|services|schedules|runbooks|reports|postmortems)\/([A-Za-z0-9_-]{1,128})$/;

export function parseSubscriptionUri(uri: string) {
  const match = URI.exec(uri);
  requireMcp(match, 'MCP_INVALID_RESOURCE_ID');
  const domain = match[1] as Domain;
  return { domain, id: match[2], readOperation: TABLES[domain].read };
}

/** The change bus every listen stream on this replica subscribes to. Events are hints, not data. */
export const mcpEventBus = new InMemoryServerEventBus(error =>
  logger.warn('mcp.subscription.listener_failed', { error: error.message })
);

let processStreams = 0;
const grantStreams = new Map<string, number>();

/** Long-lived streams have their own capacity, separate from database-work admission. */
export function acquireStreamSlot(grantId: string) {
  const forGrant = grantStreams.get(grantId) ?? 0;
  requireMcp(processStreams < MAX_STREAMS_PER_PROCESS, 'MCP_SUBSCRIPTIONS_BUSY', 503);
  requireMcp(forGrant < MAX_STREAMS_PER_GRANT, 'MCP_SUBSCRIPTIONS_LIMIT', 429);
  processStreams++;
  grantStreams.set(grantId, forGrant + 1);
  setOperationalGauge('opsknight_mcp_subscriptions_active', processStreams);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    processStreams--;
    const remaining = (grantStreams.get(grantId) ?? 1) - 1;
    if (remaining > 0) grantStreams.set(grantId, remaining);
    else grantStreams.delete(grantId);
    setOperationalGauge('opsknight_mcp_subscriptions_active', processStreams);
  };
}

const tracked = new Map<string, number>();
const lastSeen = new Map<string, number>();
let policySeen: number | undefined;
let timer: NodeJS.Timeout | undefined;
let polling = false;

/** Track URIs for one stream; returns an idempotent release. Polling runs only while streams exist. */
export function trackSubscription(uris: readonly string[]) {
  for (const uri of uris) tracked.set(uri, (tracked.get(uri) ?? 0) + 1);
  ensurePolling();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const uri of uris) {
      const count = (tracked.get(uri) ?? 1) - 1;
      if (count > 0) tracked.set(uri, count);
      else {
        tracked.delete(uri);
        lastSeen.delete(uri);
      }
    }
    if (!processStreams && !tracked.size) stopPolling();
  };
}

function ensurePolling() {
  if (timer) return;
  timer = setInterval(() => void pollChanges(), POLL_INTERVAL_MS);
  timer.unref?.();
}
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
  policySeen = undefined;
}

/**
 * One short, primary-key query per domain per tick for the tracked ids only. Exported for tests.
 * Each replica polls PostgreSQL itself, so streams on any replica observe changes made on any other.
 */
export async function pollChanges() {
  if (polling) return;
  polling = true;
  try {
    await withMcpDatabase(async () => {
      const byDomain = new Map<Domain, string[]>();
      for (const uri of tracked.keys()) {
        const { domain, id } = parseSubscriptionUri(uri);
        byDomain.set(domain, [...(byDomain.get(domain) ?? []), id]);
      }
      for (const [domain, ids] of byDomain) {
        const rows = await prisma.$queryRaw<{ id: string; updatedAt: Date }[]>`
          SELECT id, "updatedAt" FROM ${TABLES[domain].table} WHERE id = ANY(${ids}::text[])`;
        for (const row of rows) {
          const uri = `opsknight://${domain}/${row.id}`;
          const at = row.updatedAt.getTime();
          const previous = lastSeen.get(uri);
          lastSeen.set(uri, at);
          if (previous !== undefined && at !== previous)
            mcpEventBus.publish({ kind: 'resource_updated', uri });
        }
      }
      const policy = await prisma.mcpPolicy.findUnique({
        where: { id: 'default' },
        select: { updatedAt: true },
      });
      const at = policy?.updatedAt.getTime() ?? 0;
      // Writes enablement and workload policy change which tools a principal can see.
      if (policySeen !== undefined && at !== policySeen)
        mcpEventBus.publish({ kind: 'tools_list_changed' });
      policySeen = at;
    });
  } catch (error) {
    // A failed poll only delays hints; clients always re-read with fresh authorization.
    logger.warn('mcp.subscription.poll_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  } finally {
    polling = false;
  }
}

/** Test seam: forget tracked state between isolated tests. */
export function resetSubscriptionStateForTests(revalidateMs = 30_000) {
  timing.revalidateMs = revalidateMs;
  stopPolling();
  tracked.clear();
  lastSeen.clear();
  processStreams = 0;
  grantStreams.clear();
}
