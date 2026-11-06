import 'server-only';
import prisma from '@/lib/prisma';

export const INTELLIGENCE_WAKE_CHANNEL = 'intelligence_new_incident';
const pending = new Set<string>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Called only after the source/paging transaction commits. No request waits for this hint.
 * Notifications are lossy by design; the durable discovery cursor remains the recovery path.
 * Batch and memory caps keep an ingestion storm from taking extra pooled connections.
 */
export function signalIntelligenceIncident(incidentId: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(incidentId) || pending.size >= 1000) return;
  pending.add(incidentId);
  if (!timer && !flushing) {
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, 10);
    timer.unref?.();
  }
}

async function flush(): Promise<void> {
  flushing = true;
  const ids = [...pending].slice(0, 50);
  for (const id of ids) pending.delete(id);
  try {
    await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', '500', true), set_config('lock_timeout', '100', true)`;
        await tx.$executeRaw`SELECT pg_notify(${INTELLIGENCE_WAKE_CHANNEL}, ${JSON.stringify(ids)})`;
      },
      { maxWait: 100, timeout: 1000 }
    );
  } catch {
    // Do not retry hints or log source identifiers. Polling repairs any dropped notification.
  } finally {
    flushing = false;
    if (pending.size) {
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, 10);
      timer.unref?.();
    }
  }
}
