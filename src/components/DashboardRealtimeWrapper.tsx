'use client';

import { useRealtime } from '@/hooks/useRealtime';
import { useEffect, useState } from 'react';
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
  return (
    <DashboardRealtimeContent
      onMetricsUpdate={onMetricsUpdate}
      onIncidentsUpdate={onIncidentsUpdate}
    >
      {children}
    </DashboardRealtimeContent>
  );
}

function DashboardRealtimeContent({
  children,
  onMetricsUpdate,
  onIncidentsUpdate,
}: DashboardRealtimeWrapperProps) {
  const { isConnected, metrics, recentIncidents, error } = useRealtime();
  const [showDisconnected, setShowDisconnected] = useState(false);

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
    if (recentIncidents && recentIncidents.length > 0 && onIncidentsUpdate) {
      onIncidentsUpdate(recentIncidents);
    }
  }, [recentIncidents, onIncidentsUpdate]);

  // Show connection status indicator (optional)
  if (error && process.env.NODE_ENV === 'development') {
    logger.warn('Real-time connection error', { error });
  }

  return (
    <>
      {children}
      {showDisconnected && !isConnected && (
        <div
          className="fixed bottom-4 right-4 z-50 px-3.5 py-2 bg-amber-600 text-white text-xs font-medium rounded-lg shadow-lg"
          aria-live="polite"
          aria-atomic="true"
        >
          Live updates paused. Refresh to verify the latest statistics.
        </div>
      )}
    </>
  );
}
