/** Runs `callback` once later and returns a function that cancels it. */
export type FrameScheduler = (callback: () => void) => () => void;

/**
 * One animation frame while the page is visible. Browsers pause animation frames in a background tab, so a
 * hidden page falls back to a short timer and an answer streaming into a closed or hidden panel keeps
 * arriving.
 */
export const nextFrame: FrameScheduler = callback => {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function' &&
    document.visibilityState !== 'hidden'
  ) {
    const id = window.requestAnimationFrame(() => callback());
    return () => window.cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 50);
  return () => clearTimeout(id);
};

export type DeltaBatcher = {
  /** Queue streamed text; the first piece in a frame schedules one flush for the frame. */
  push(text: string): void;
  /** Apply queued text now. Call before any other update to the same turn so events stay in order. */
  flush(): void;
  /** Drop queued text without applying it (the answer was replaced or abandoned). */
  cancel(): void;
};

/**
 * Streamed answers arrive as many small text deltas. Applying each one re-renders the message and
 * re-parses its markdown, so a long answer costs hundreds of renders. The batcher joins every delta that
 * arrives within one animation frame into a single update.
 */
export function createDeltaBatcher(
  apply: (text: string) => void,
  schedule: FrameScheduler = nextFrame
): DeltaBatcher {
  let pending = '';
  let cancelScheduled: (() => void) | null = null;
  const flush = () => {
    cancelScheduled?.();
    cancelScheduled = null;
    if (!pending) return;
    const text = pending;
    pending = '';
    apply(text);
  };
  return {
    push(text) {
      if (!text) return;
      pending += text;
      if (!cancelScheduled)
        cancelScheduled = schedule(() => {
          cancelScheduled = null;
          flush();
        });
    },
    flush,
    cancel() {
      cancelScheduled?.();
      cancelScheduled = null;
      pending = '';
    },
  };
}
