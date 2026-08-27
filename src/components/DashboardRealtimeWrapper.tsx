'use client';

import { useRealtime } from '@/hooks/useRealtime';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logger } from '@/lib/logger';

interface DashboardRealtimeWrapperProps {
  children: React.ReactNode;
  onMetricsUpdate?: (metrics: {
    open: number;
    acknowledged: number;
    resolved24h: number;
    highUrgency: number;
  }) => void;
  onIncidentsUpdate?: (incidents: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Wrapper component that integrates real-time updates into the dashboard
 * Automatically refreshes data when real-time events are received
 */
export default function DashboardRealtimeWrapper({
  children,
  onMetricsUpdate,
  onIncidentsUpdate,
}: DashboardRealtimeWrapperProps) {
  const { isConnected, metrics, recentIncidents, error } = useRealtime();
  const router = useRouter();
  const [showDisconnected, setShowDisconnected] = useState(false);

  useEffect(() => {
    if (isConnected) {
      setShowDisconnected(false); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    if (error) {
      setShowDisconnected(true); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    const timer = window.setTimeout(() => setShowDisconnected(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [isConnected, error]);

  useEffect(() => {
    if (metrics && onMetricsUpdate) {
      onMetricsUpdate(metrics);
    }
  }, [metrics, onMetricsUpdate]);

  useEffect(() => {
    if (recentIncidents && recentIncidents.length > 0) {
      if (onIncidentsUpdate) {
        onIncidentsUpdate(recentIncidents);
      }

      // Check sessionStorage for last refresh time (persists across remounts/refreshes)
      // This is critical because router.refresh() might cause a full remount
      const now = Date.now();
      const lastRefreshCtx = sessionStorage.getItem('dashboard_last_refresh');
      const lastRefresh = lastRefreshCtx ? parseInt(lastRefreshCtx, 10) : 0;

      // Only auto-refresh if it's been at least 15 seconds since the last one
      if (now - lastRefresh > 15000) {
        sessionStorage.setItem('dashboard_last_refresh', now.toString());
        logger.debug('Triggering dashboard refresh from realtime update');
        router.refresh();
      } else {
        logger.debug('Skipping dashboard refresh (debounced)', {
          timeSinceLast: now - lastRefresh,
        });
      }
    }
  }, [recentIncidents, onIncidentsUpdate, router]);

  // Show connection status indicator (optional)
  if (error && process.env.NODE_ENV === 'development') {
    logger.warn('Real-time connection error', { error });
  }

  return (
    <>
      {children}
      {showDisconnected && !isConnected && (
        <div
          style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1rem',
            padding: '0.5rem 1rem',
            background: 'var(--color-warning)',
            color: 'white',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.875rem',
            zIndex: 1000,
          }}
          aria-live="polite"
          aria-atomic="true"
        >
          Live updates paused. Refresh to verify the latest statistics.
        </div>
      )}
    </>
  );
}
