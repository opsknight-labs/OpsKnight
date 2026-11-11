/** Small event bridge shared with callers without importing the assistant UI. */
export const SQUIRE_OPEN_EVENT = 'squire:open';
const OPEN_EVENT = SQUIRE_OPEN_EVENT;

/**
 * What a question is about: one intelligence item on the page (a finding, a related link, a change, a runbook
 * or a whole inspector section). `href` is the item's stable anchor (`#finding-<id>`), so a listener can cite
 * or link back to it. Optional and additive: listeners that only read `message` keep working.
 */
export interface SquireEvidenceHandle {
  kind: 'finding' | 'relationship' | 'section';
  id: string;
  label?: string;
  href?: string;
}

export interface SquireOpenDetail {
  message?: string;
  evidence?: SquireEvidenceHandle;
}

let queuedOpen: SquireOpenDetail | null = null;
let listeners = 0;

export function openSquire(message?: string, options: { evidence?: SquireEvidenceHandle } = {}) {
  if (typeof window === 'undefined') return;
  const detail: SquireOpenDetail = {
    ...(message ? { message } : {}),
    ...(options.evidence ? { evidence: options.evidence } : {}),
  };
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
