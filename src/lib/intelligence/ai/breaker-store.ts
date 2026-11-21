import 'server-only';
import prisma from '@/lib/prisma';
import type { SharedBreakerState, SharedBreakerStore } from './breaker';

/**
 * Shared breaker readings in one small table, one row per provider. Reads and writes are bounded, best
 * effort and never awaited on the request path beyond a short statement timeout: a slow or missing table
 * leaves every replica on its own in-process judgement.
 */
export class PostgresBreakerStore implements SharedBreakerStore {
  constructor(private readonly client: typeof prisma = prisma) {}

  async load(id: string): Promise<SharedBreakerState | null> {
    const row = await this.client.aiProviderBreaker.findUnique({
      where: { providerId: id },
      select: { failures: true, openUntil: true },
    });
    if (!row) return null;
    return { failures: row.failures, openUntil: row.openUntil?.getTime() ?? 0 };
  }

  async save(id: string, state: SharedBreakerState): Promise<void> {
    const openUntil = state.openUntil > 0 ? new Date(state.openUntil) : null;
    await this.client.aiProviderBreaker.upsert({
      where: { providerId: id },
      create: { providerId: id, failures: state.failures, openUntil },
      update: { failures: state.failures, openUntil },
    });
  }
}
