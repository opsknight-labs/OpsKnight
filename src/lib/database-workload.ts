import { AsyncLocalStorage } from 'node:async_hooks';

declare global {
  var opsKnightDatabaseWorkload: AsyncLocalStorage<'mcp'> | undefined;
}

// Next can load this module in several chunks. Both route wrappers and Prisma
// must consult the same context; request headers can never select a pool.
const storage = (globalThis.opsKnightDatabaseWorkload ??= new AsyncLocalStorage<'mcp'>());

export function withMcpDatabase<T>(callback: () => T): T {
  return storage.run('mcp', callback);
}

export function isMcpDatabaseWorkload() {
  return storage.getStore() === 'mcp';
}
