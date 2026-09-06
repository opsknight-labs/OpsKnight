'use client';

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { logger } from '@/lib/logger';

export type RealtimeEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'incidents_updated'; incidents: RealtimeIncident[]; timestamp: string }
  | {
      type: 'metrics_updated';
      metrics: { open: number; acknowledged: number; resolved24h: number; highUrgency: number };
      timestamp: string;
    }
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'authorization_revoked' }
  | { type: 'error'; message: string; timestamp: string };

export type RealtimeMetrics = {
  open: number;
  acknowledged: number;
  resolved24h: number;
  highUrgency: number;
  active?: number;
  snoozed?: number;
  suppressed?: number;
  unassigned?: number;
};

export type RealtimeIncident = Record<string, unknown>;

function useRealtimeConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [metrics, setMetrics] = useState<RealtimeMetrics | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<RealtimeIncident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const authorizationRevoked = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      // Reset attempts and reconnect immediately
      if (authorizationRevoked.current) return;
      reconnectAttempts.current = 0;
      // Close existing connection and let the reconnect logic re-open it
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Trigger reconnect by updating a counter state
      setReconnectTrigger(prev => prev + 1);
    };
    window.addEventListener('online', handleOnline);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleOnline();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    authorizationRevoked.current = false;

    const connect = () => {
      if (!mounted) return;

      try {
        const eventSource = new EventSource('/api/realtime/stream');
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          if (!mounted) return;
          setIsConnected(true);
          setError(null);
          reconnectAttempts.current = 0;
        };

        eventSource.onmessage = event => {
          if (!mounted) return;

          try {
            const data: RealtimeEvent = JSON.parse(event.data);

            switch (data.type) {
              case 'connected':
                setIsConnected(true);
                break;
              case 'incidents_updated':
                setRecentIncidents(data.incidents);
                break;
              case 'metrics_updated':
                setMetrics(data.metrics);
                break;
              case 'heartbeat':
                // Keep connection alive
                break;
              case 'error':
                setError(data.message);
                break;
              case 'authorization_revoked':
                authorizationRevoked.current = true;
                eventSource.close();
                eventSourceRef.current = null;
                setIsConnected(false);
                setError('Real-time authorization was revoked. Sign in again to reconnect.');
                break;
            }
          } catch (err) {
            logger.error('Failed to parse SSE event', { component: 'useRealtime', error: err });
          }
        };

        eventSource.onerror = () => {
          if (!mounted || authorizationRevoked.current) return;
          setIsConnected(false);
          eventSource.close();

          // Attempt to reconnect with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mounted) connect();
          }, delay);
        };
      } catch (err) {
        logger.error('Failed to create EventSource', { component: 'useRealtime', error: err });
        setError('Real-time updates not available');
      }
    };

    connect();

    return () => {
      mounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [reconnectTrigger]);

  return {
    isConnected,
    metrics,
    recentIncidents,
    error,
  };
}

type RealtimeContextValue = ReturnType<typeof useRealtimeConnection>;
const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const value = useRealtimeConnection();
  return createElement(RealtimeContext.Provider, { value }, children);
}

/** Consume the single realtime connection owned by the nearest provider. */
export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used within RealtimeProvider');
  return value;
}
