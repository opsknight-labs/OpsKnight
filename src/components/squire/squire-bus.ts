/** Small event bridge shared with callers without importing the assistant UI. */
const OPEN_EVENT = 'squire:open';
let queuedOpen: { message?: string } | null = null;
let listeners = 0;

export function openSquire(message?: string) {
  if (typeof window === 'undefined') return;
  const detail = message ? { message } : {};
  if (!listeners) queuedOpen = detail;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail }));
}

/** Replay an early click after the launcher's effects have installed its send handler. */
export function subscribeSquireOpen(onOpen: (event: Event) => void): () => void {
  window.addEventListener(OPEN_EVENT, onOpen);
  listeners += 1;
  const queued = queuedOpen;
  queuedOpen = null;
  let replayPending = Boolean(queued);
  const replay = queued
    ? window.setTimeout(() => {
        replayPending = false;
        onOpen(new CustomEvent(OPEN_EVENT, { detail: queued }));
      })
    : undefined;
  return () => {
    listeners -= 1;
    if (replay !== undefined) {
      window.clearTimeout(replay);
      // React Strict Mode may unsubscribe before the replay has run.
      if (replayPending && queued) queuedOpen = queued;
    }
    window.removeEventListener(OPEN_EVENT, onOpen);
  };
}
