'use client';

import { RealtimeProvider, useRealtime } from '@/hooks/useRealtime';
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
  return (
    <RealtimeProvider>
      <DashboardRealtimeContent
        onMetricsUpdate={onMetricsUpdate}
        onIncidentsUpdate={onIncidentsUpdate}
      >
        {children}
      </DashboardRealtimeContent>
    </RealtimeProvider>
  );
}

function DashboardRealtimeContent({
  children,
  onMetricsUpdate,
  onIncidentsUpdate,
}: DashboardRealtimeWrapperProps) {
  const router = useRouter();
  const { isConnected, metrics, recentIncidents, error } = useRealtime();
  const [showDisconnected, setShowDisconnected] = useState(false);
  const [dismissedIncidentKey, setDismissedIncidentKey] = useState('');
  const incidentUpdateKey = recentIncidents?.length
    ? JSON.stringify(
        recentIncidents.map(incident => [
          incident.id,
          incident.updatedAt,
          incident.status,
          incident.urgency,
          incident.escalationStatus,
        ])
      )
    : '';
  const hasUpdates =
    !onIncidentsUpdate && Boolean(incidentUpdateKey) && dismissedIncidentKey !== incidentUpdateKey;

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
      {hasUpdates && (
        <button
          type="button"
          onClick={() => {
            setDismissedIncidentKey(incidentUpdateKey);
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
