'use client';

import { useRouter } from 'next/navigation';
import { useRunbookRefresh } from './useRunbookRefresh';

export type RunbookLiveRefreshProps = {
  enabled?: boolean;
  intervalMs?: number;
  refreshOnFocus?: boolean;
};

export function RunbookLiveRefresh({
  enabled = true,
  intervalMs = 20000,
  refreshOnFocus = true,
}: RunbookLiveRefreshProps) {
  const router = useRouter();
  useRunbookRefresh(router, { enabled, intervalMs, refreshOnFocus });
  return null;
}
