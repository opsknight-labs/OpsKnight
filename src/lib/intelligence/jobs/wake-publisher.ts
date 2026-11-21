import 'server-only';
import prisma from '@/lib/prisma';

export const INTELLIGENCE_WAKE_CHANNEL = 'intelligence_new_incident';
export const INTELLIGENCE_WAKE_THROTTLE_MS = 2000;
const MAX_PENDING = 1000;
const pending = new Set<string>();
const sentAt = new Map<string, number>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let timerAt = 0;

function expire(now: number) {
  // Insertion order follows the last dispatch time. Each entry is removed once, amortized O(1).
  for (const [id, at] of sentAt) {
    if (now - at < INTELLIGENCE_WAKE_THROTTLE_MS) break;
    sentAt.delete(id);
  }
}

function arm() {
  if (flushing || !pending.size) return;
  const now = performance.now();
  let due = Infinity;
  for (const id of pending)
    due = Math.min(
      due,
      (sentAt.get(id) ?? now - INTELLIGENCE_WAKE_THROTTLE_MS) + INTELLIGENCE_WAKE_THROTTLE_MS
    );
  const at = now + Math.max(10, due - now);
  if (timer && timerAt <= at) return;
  if (timer) clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, at - now);
  timer.unref?.();
}

/** Post-commit, non-blocking hint. Per-process throttling keeps a hot dedup key to one dispatch
 * per two seconds, including a trailing wake for the latest dirty state. The durable queue coalesces
 * hints across replicas; discovery repairs dropped hints. No caller waits for a pooled connection.
 */
export function signalIntelligenceIncident(incidentId: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(incidentId)) return;
  if (pending.size >= MAX_PENDING && !pending.has(incidentId)) return;
  expire(performance.now());
  if (sentAt.size >= MAX_PENDING && !sentAt.has(incidentId)) return;
  pending.add(incidentId);
  arm();
}

async function flush(): Promise<void> {
  flushing = true;
  const now = performance.now();
  expire(now);
  const ids: string[] = [];
  for (const id of pending) {
    const last = sentAt.get(id);
    if (last !== undefined && now - last < INTELLIGENCE_WAKE_THROTTLE_MS) continue;
    pending.delete(id);
    if (sentAt.size >= MAX_PENDING && !sentAt.has(id)) continue;
    sentAt.delete(id);
    sentAt.set(id, now);
    ids.push(id);
    if (ids.length >= 50) break;
  }
  try {
    if (!ids.length) return;
    await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', '500', true), set_config('lock_timeout', '100', true)`;
        await tx.$executeRaw`SELECT pg_notify(${INTELLIGENCE_WAKE_CHANNEL}, ${JSON.stringify(ids)})`;
      },
      { maxWait: 100, timeout: 1000 }
    );
  } catch {
    // A failed hint is not retried automatically and exposes no source identifiers.
  } finally {
    flushing = false;
    arm();
  }
}
