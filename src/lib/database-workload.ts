import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Background workloads that get their own small Prisma pool inside a shared process:
 * - `mcp`: MCP requests, with hard SQL budgets.
 * - `intelligence`: the intelligence lane when it shares a process with ingestion and paging, so
 *   analysis transactions can never queue ahead of `processEvent` for a pooled connection.
 */
export type DatabaseWorkload = 'mcp' | 'intelligence';

declare global {
  var opsKnightDatabaseWorkload: AsyncLocalStorage<DatabaseWorkload> | undefined;
}

// Next can load this module in several chunks. Both route wrappers and Prisma
// must consult the same context; request headers can never select a pool.
const storage = (globalThis.opsKnightDatabaseWorkload ??=
  new AsyncLocalStorage<DatabaseWorkload>());

export function withMcpDatabase<T>(callback: () => T): T {
  return storage.run('mcp', callback);
}

export function isMcpDatabaseWorkload() {
  return storage.getStore() === 'mcp';
}

/** Runs `callback` (and every async continuation it starts) on the intelligence lane's own pool. */
export function withIntelligenceDatabase<T>(callback: () => T): T {
  return storage.run('intelligence', callback);
}

export function isIntelligenceDatabaseWorkload() {
  return storage.getStore() === 'intelligence';
}
