import 'server-only';
import { getRunbookWorkerEvidence } from './worker-heartbeats';
import { reconcileRunbooks } from './reconciler';
import { logger } from '@/lib/logger';
let timer: NodeJS.Timeout | null = null;
let active: Promise<void> | null = null;
/** Recovery only: this watchdog never executes or retries physical actions itself. */
export async function runRunbookWatchdog() {
  if (active) return active;
  active = (async () => {
    const evidence = await getRunbookWorkerEvidence(new Date());
    if (evidence.status === 'HEALTHY') return;
    await reconcileRunbooks(100);
  })()
    .catch(() =>
      logger.warn(
        '[RunbookWatchdog] Recovery sweep unavailable; inspect worker and database health'
      )
    )
    .finally(() => {
      active = null;
    });
  return active;
}
export function startRunbookWatchdog() {
  if (timer) return;
  void runRunbookWatchdog();
  timer = setInterval(() => void runRunbookWatchdog(), 30_000);
  timer.unref?.();
}
export async function stopRunbookWatchdog() {
  if (timer) clearInterval(timer);
  timer = null;
  await active;
}
