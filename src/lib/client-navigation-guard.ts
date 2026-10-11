type NavigationGuard = (resume: () => void) => void;
let guard: NavigationGuard | undefined;
let sessionId: string | undefined;

export function registerNavigationGuard(callback: NavigationGuard) {
  guard = callback;
  return () => {
    if (guard === callback) guard = undefined;
  };
}

/** Track App Router entries without dropping router state or adding extra entries. */
export function installNavigationHistoryTracking() {
  sessionId ??= Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const indexOf = (state: unknown): number | undefined => {
    if (!state || typeof state !== 'object') return undefined;
    const marker: unknown = Object.getOwnPropertyDescriptor(
      state,
      '__opsknightHistoryIndex'
    )?.value;
    if (
      !marker ||
      typeof marker !== 'object' ||
      !('session' in marker) ||
      marker.session !== sessionId
    )
      return undefined;
    const index: unknown = Object.getOwnPropertyDescriptor(marker, 'index')?.value;
    return typeof index === 'number' && Number.isSafeInteger(index) ? index : undefined;
  };
  let currentIndex = indexOf(history.state) ?? 0;
  let restoring = false;
  let allowNext = false;
  let resumeAfterRestore: (() => void) | undefined;
  const withIndex = (state: unknown, index: number) => ({
    ...(state && typeof state === 'object' ? state : {}),
    __opsknightHistoryIndex: { session: sessionId, index },
  });
  const push: History['pushState'] = function (state, unused, url) {
    originalPush.call(history, withIndex(state, currentIndex + 1), unused, url);
    currentIndex++;
  };
  const replace: History['replaceState'] = function (state, unused, url) {
    originalReplace.call(history, withIndex(state, currentIndex), unused, url);
  };
  history.pushState = push;
  history.replaceState = replace;
  replace(history.state, '', window.location.href);
  const onPop = (event: PopStateEvent) => {
    if (restoring) {
      event.stopImmediatePropagation();
      restoring = false;
      const resume = resumeAfterRestore;
      resumeAfterRestore = undefined;
      resume?.();
      return;
    }
    // Entries preceding initialization are earlier pages, outside tracked App Router history.
    const nextIndex = indexOf(event.state) ?? currentIndex - 1;
    const delta = nextIndex - currentIndex;
    if (guard && !allowNext && delta !== 0) {
      event.stopImmediatePropagation();
      restoring = true;
      history.go(-delta);
      guard(() => {
        const resume = () => {
          allowNext = true;
          history.go(delta);
        };
        if (restoring) resumeAfterRestore = resume;
        else resume();
      });
      return;
    }
    allowNext = false;
    currentIndex = nextIndex;
  };
  // Capture before the App Router observes the transition; cancellation restores the current entry.
  window.addEventListener('popstate', onPop, true);
  return () => {
    window.removeEventListener('popstate', onPop, true);
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}
