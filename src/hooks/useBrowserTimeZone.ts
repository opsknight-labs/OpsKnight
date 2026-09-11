'use client';

import { useEffect, useState } from 'react';

/**
 * Visitor browser IANA zone. Returns UTC on the server and updates to the
 * resolved browser zone after mount without forcing a parent to be 'use client'.
 * A zero-delay timer mirrors the previous StatusPageV3 behavior (avoid
 * synchronous setState in effect) while coalescing rapid remounts.
 */
export function useBrowserTimeZone(fallback = 'UTC'): string {
  const [timeZone, setTimeZone] = useState(fallback);
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
    const id = window.setTimeout(() => setTimeZone(tz), 0);
    return () => window.clearTimeout(id);
  }, [fallback]);
  return timeZone;
}
