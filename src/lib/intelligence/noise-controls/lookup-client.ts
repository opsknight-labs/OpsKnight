import 'server-only';
import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import {
  configurePrismaDatasource,
  selectPrePagingLookupDatasourceUrl,
} from '@/lib/prisma-datasource';
import { PREPAGING_LIMITS } from './contract';

/**
 * A small dedicated pool for the pre-paging lookups, so the hook costs the event one round trip
 * instead of four (savepoint, timeout, read, rollback) on the event transaction.
 *
 * Every connection starts with `statement_timeout` (and `lock_timeout`) equal to the shared deadline,
 * so the server cancels a slow lookup on its own; the caller abandons it at the same deadline. Because
 * the read runs on another connection, an abandoned or failing lookup never delays, blocks or aborts the
 * event transaction. Created lazily, only once a service has a SHADOW or ON policy; OFF never opens it.
 *
 * Reads outside the event transaction see exactly what the transaction would (READ COMMITTED, and the
 * event has written nothing these lookups read before the hook runs).
 *
 * Two connections per process (on the direct route, `DIRECT_DATABASE_URL` when set, because poolers may
 * drop startup options). A datasource behind a transaction pooler (`pgbouncer=true`) or a missing one
 * keeps the lookups on the event transaction under a savepoint instead (`ingest.ts`).
 */

const POOL_SIZE = 2;
const MAX_DEADLINE_MS = 50;
let deadlineOverrideMs: number | null = null;

/**
 * Process-level override of the shared deadline (1–50 ms; null restores the 5 ms default). For
 * benchmarks and tests that must not depend on host timing; production code never calls it.
 */
export function setPrePagingDeadlineMs(ms: number | null): void {
  deadlineOverrideMs = ms === null ? null : Math.min(MAX_DEADLINE_MS, Math.max(1, Math.round(ms)));
}

/** The deadline the hook enforces in this process. */
export function prePagingDeadlineMs(): number {
  return deadlineOverrideMs ?? PREPAGING_LIMITS.deadlineMs;
}

/** Server-side timeout for a client-side deadline: whole milliseconds, at least 1. */
export function lookupTimeoutMs(deadlineMs: number): number {
  return Math.max(1, Math.ceil(deadlineMs));
}

export type NoiseLookupRoute = 'pool' | 'transaction';
let routeOverride: NoiseLookupRoute | null = null;

/** Forces a route (null restores the default, `pool`). For tests and benchmarks only. */
export function setNoiseLookupRoute(route: NoiseLookupRoute | null): void {
  routeOverride = route;
}

/** The lookup pool's datasource: a small pool with deadline-sized server-side timeouts, or null. */
export function noiseLookupDatasourceUrl(
  rawUrl: string | undefined,
  timeoutMs: number,
  poolSize: number
): string | null {
  const configured = configurePrismaDatasource(rawUrl, String(poolSize));
  if (!configured) return null;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return null;
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
  // A transaction pooler may drop the startup timeouts this pool relies on.
  if (url.searchParams.get('pgbouncer') === 'true') return null;
  url.searchParams.set('connection_limit', String(poolSize));
  // Seconds (Prisma's floor). The caller's deadline abandons a queued lookup long before either fires.
  url.searchParams.set('pool_timeout', '1');
  url.searchParams.set('connect_timeout', '3');
  // Overrides inherited options on purpose: a shared URL must not relax the deadline.
  url.searchParams.set(
    'options',
    `-c statement_timeout=${timeoutMs} -c lock_timeout=${timeoutMs} -c jit=off -c application_name=opsknight-prepaging`
  );
  return url.toString();
}

let current: { client: PrismaClient; timeoutMs: number } | null = null;
let unavailable = false;

/**
 * The pool for `timeoutMs`, or null when the route is `transaction` or no usable datasource exists
 * (the caller then uses the event transaction). A changed deadline (tests, benchmarks) replaces it.
 */
export function getNoiseLookupClient(timeoutMs: number): PrismaClient | null {
  if (unavailable || routeOverride === 'transaction') return null;
  if (current?.timeoutMs === timeoutMs) return current.client;
  const url = noiseLookupDatasourceUrl(selectPrePagingLookupDatasourceUrl(), timeoutMs, POOL_SIZE);
  if (!url) {
    unavailable = true;
    return null;
  }
  const previous = current?.client;
  const client = new PrismaClient({ datasourceUrl: url });
  current = { client, timeoutMs };
  void previous?.$disconnect().catch(() => undefined);
  // Connect in the background; lookups made before it is ready fail open on the deadline.
  client.$connect().catch(error => {
    logger.warn('[Intelligence] Pre-paging lookup pool failed to connect', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return client;
}

/**
 * Opens the pool ahead of the first event once a SHADOW or ON policy exists (called from the background
 * snapshot refresh, never from the hot path), so the first lookups do not fail open on connect time.
 */
export async function warmNoiseLookupClient(): Promise<void> {
  const client = getNoiseLookupClient(lookupTimeoutMs(prePagingDeadlineMs()));
  await client?.$connect().catch(() => undefined);
}

export async function disconnectNoiseLookupClient(): Promise<void> {
  const client = current?.client;
  current = null;
  unavailable = false;
  await client?.$disconnect();
}
