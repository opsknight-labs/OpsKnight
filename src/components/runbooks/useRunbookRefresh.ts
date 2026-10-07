'use client';

import { useEffect } from 'react';
import type { useRouter } from 'next/navigation';

export type RunbookRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
  refreshOnFocus?: boolean;
};

export function useRunbookRefresh(
  router: ReturnType<typeof useRouter>,
  options: boolean | RunbookRefreshOptions = true
) {
  const config = typeof options === 'boolean' ? { enabled: options } : options;
  const { enabled = true, intervalMs = 15000, refreshOnFocus = true } = config;

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };

    let timer: number | undefined;
    if (enabled && intervalMs > 0) {
      timer = window.setInterval(refresh, intervalMs);
    }

    if (refreshOnFocus) {
      window.addEventListener('focus', refresh);
    }

    return () => {
      if (timer) window.clearInterval(timer);
      if (refreshOnFocus) window.removeEventListener('focus', refresh);
    };
  }, [enabled, intervalMs, refreshOnFocus, router]);
}
