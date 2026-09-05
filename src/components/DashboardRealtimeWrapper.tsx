'use client';

import { useRealtime } from '@/hooks/useRealtime';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  const { isConnected, metrics, recentIncidents, error } = useRealtime();
  const [showDisconnected, setShowDisconnected] = useState(false);
  const [hasUpdates, setHasUpdates] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setShowDisconnected(!isConnected),
      isConnected || error ? 0 : 10_000
    );
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
      } else {
        // Server-rendered dashboard children cannot consume the projection
        // directly. Surface an explicit refresh action instead of multiplying
        // expensive server renders automatically during an incident storm.
        setHasUpdates(true);
      }
    }
  }, [recentIncidents, onIncidentsUpdate]);

  // Show connection status indicator (optional)
  if (error && process.env.NODE_ENV === 'development') {
    logger.warn('Real-time connection error', { error });
  }

  return (
    <>
      {children}
      {hasUpdates && (
        <button
          type="button"
          onClick={() => {
            setHasUpdates(false);
            router.refresh();
          }}
          style={{
            position: 'fixed',
            bottom: showDisconnected ? '4.5rem' : '1rem',
            right: '1rem',
            padding: '0.5rem 1rem',
            background: 'var(--color-primary)',
            color: 'white',
            border: 0,
            borderRadius: 'var(--radius-md)',
            fontSize: '0.875rem',
            zIndex: 1000,
            cursor: 'pointer',
          }}
        >
          Dashboard updates available — refresh
        </button>
      )}
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
