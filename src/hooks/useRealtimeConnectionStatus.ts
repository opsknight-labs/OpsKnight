'use client';

import { useEffect, useState } from 'react';
import { useOptionalRealtime } from '@/hooks/useRealtime';

export type RealtimeConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** How long the stream may be down before "Reconnecting" becomes "Offline". */
export const OFFLINE_AFTER_MS = 30_000;

export type RealtimeConnectionInput = {
  isConnected: boolean;
  isRevoked: boolean;
  isOnline: boolean;
  outageStartedAt: number | null;
};

export function getRealtimeConnectionStatus(
  input: RealtimeConnectionInput,
  now: number
): RealtimeConnectionStatus {
  if (input.isRevoked || !input.isOnline) return 'offline';
  if (input.isConnected) return 'live';
  if (input.outageStartedAt === null) return 'connecting';
  return now - input.outageStartedAt >= OFFLINE_AFTER_MS ? 'offline' : 'reconnecting';
}

/** Live / Reconnecting / Offline for the console's realtime stream; null outside a provider. */
export function useRealtimeConnectionStatus(): RealtimeConnectionStatus | null {
  const realtime = useOptionalRealtime();
  const outageStartedAt = realtime?.outageStartedAt ?? null;
  // Re-evaluated when the outage crosses the offline threshold.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (outageStartedAt === null) return;
    const remaining = outageStartedAt + OFFLINE_AFTER_MS - Date.now();
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, remaining) + 50);
    return () => window.clearTimeout(timer);
  }, [outageStartedAt]);

  if (!realtime) return null;
  return getRealtimeConnectionStatus(
    {
      isConnected: realtime.isConnected,
      isRevoked: realtime.isRevoked,
      isOnline: realtime.isOnline,
      outageStartedAt,
    },
    Math.max(now, outageStartedAt ?? 0)
  );
}
