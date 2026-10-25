'use client';

import {
  createContext,
  createElement,
  Fragment,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { logger } from '@/lib/logger';
import {
  notifySessionExpired,
  verifyClientSession,
  isTerminalSessionError,
} from '@/lib/client-auth-recovery';

export type RealtimeEvent =
  | { type: 'connected'; timestamp: string }
  | { type: 'incidents_updated'; incidents: RealtimeIncident[]; timestamp: string }
  | {
      type: 'metrics_updated';
      metrics: {
        open: number;
        acknowledged: number;
        resolved24h: number;
        highUrgency: number;
        mediumUrgency?: number;
        lowUrgency?: number;
        active?: number;
      };
      timestamp: string;
    }
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'changed'; generation: string; timestamp: string }
  | { type: 'authorization_revoked' }
  | { type: 'error'; message: string; timestamp: string };

export type RealtimeMetrics = {
  open: number;
  acknowledged: number;
  resolved24h: number;
  highUrgency: number;
  mediumUrgency?: number;
  lowUrgency?: number;
  active?: number;
  snoozed?: number;
  suppressed?: number;
  unassigned?: number;
};

export type RealtimeIncident = Record<string, unknown>;

/**
 * `full` keeps the legacy incident/metrics payloads used across the console. `signal` receives
 * only compact change signals (generation + heartbeat); the subscriber reads authoritative data
 * from its own authorized API. Always-on displays use `signal`.
 */
export type RealtimeMode = 'full' | 'signal';

function useRealtimeConnection(mode: RealtimeMode) {
  const [isConnected, setIsConnected] = useState(false);
  const [metrics, setMetrics] = useState<RealtimeMetrics | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<RealtimeIncident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [revision, setRevision] = useState(0);
  // Bumps on every successful (re)connect so consumers can re-fetch canonical state.
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [isRevoked, setIsRevoked] = useState(false);
  // Durable change generation and a counter that bumps on every `changed` signal. Kept apart
  // from `revision` so route-refresh consumers are not triggered by every change.
  const [changeGeneration, setChangeGeneration] = useState<string | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const authorizationRevoked = useRef(false);
  const lastEventAt = useRef(0);

  useEffect(() => {
    const disconnect = () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(false);
    };

    const reconnect = () => {
      if (authorizationRevoked.current || document.visibilityState === 'hidden') return;
      reconnectAttempts.current = 0;
      disconnect();
      setReconnectTrigger(prev => prev + 1);
    };

    const handleOnline = () => reconnect();
    const handleOffline = () => disconnect();
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        disconnect();
        return;
      }
      if (!eventSourceRef.current || Date.now() - lastEventAt.current >= 90_000) reconnect();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    authorizationRevoked.current = false;

    const connect = () => {
      if (
        !mounted ||
        authorizationRevoked.current ||
        document.visibilityState === 'hidden' ||
        !navigator.onLine
      ) {
        return;
      }

      try {
        const eventSource = new EventSource(
          mode === 'signal' ? '/api/realtime/stream?mode=signal' : '/api/realtime/stream'
        );
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          if (!mounted) return;
          setIsConnected(true);
          setError(null);
          reconnectAttempts.current = 0;
          lastEventAt.current = Date.now();
          setLastMessageAt(lastEventAt.current);
          setConnectionEpoch(value => value + 1);
        };

        eventSource.onmessage = event => {
          if (!mounted) return;

          try {
            const data: RealtimeEvent = JSON.parse(event.data);
            lastEventAt.current = Date.now();
            setLastMessageAt(lastEventAt.current);

            switch (data.type) {
              case 'connected':
                setIsConnected(true);
                break;
              case 'incidents_updated':
                setRecentIncidents(data.incidents);
                setRevision(value => value + 1);
                break;
              case 'metrics_updated':
                setMetrics(data.metrics);
                setRevision(value => value + 1);
                break;
              case 'heartbeat':
                break;
              case 'changed':
                setChangeGeneration(data.generation);
                setChangeCount(value => value + 1);
                break;
              case 'error':
                setError(data.message);
                break;
              case 'authorization_revoked':
                authorizationRevoked.current = true;
                setIsRevoked(true);
                eventSource.close();
                eventSourceRef.current = null;
                setIsConnected(false);
                setError('Real-time authorization was revoked. Sign in again to reconnect.');
                notifySessionExpired();
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
          if (eventSourceRef.current === eventSource) eventSourceRef.current = null;
          if (document.visibilityState === 'hidden' || !navigator.onLine) return;

          void verifyClientSession().then(result => {
            if (!mounted || authorizationRevoked.current) return;
            if (isTerminalSessionError(result)) {
              authorizationRevoked.current = true;
              setIsRevoked(true);
              setError('Real-time authorization was revoked. Sign in again to reconnect.');
              notifySessionExpired();
              return;
            }

            const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30_000);
            const delay = Math.min(30_000, Math.round(baseDelay * (0.5 + Math.random())));
            reconnectAttempts.current += 1;
            reconnectTimeoutRef.current = setTimeout(() => {
              if (mounted) connect();
            }, delay);
          });
        };
      } catch (err) {
        logger.error('Failed to create EventSource', { component: 'useRealtime', error: err });
        setError('Real-time updates not available');
      }
    };

    connect();

    return () => {
      mounted = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [reconnectTrigger, mode]);

  return {
    isConnected,
    metrics,
    recentIncidents,
    error,
    revision,
    connectionEpoch,
    lastMessageAt,
    isRevoked,
    changeGeneration,
    changeCount,
  };
}

type RealtimeContextValue = ReturnType<typeof useRealtimeConnection>;
const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function RealtimeRootProvider({
  children,
  mode,
}: {
  children?: ReactNode;
  mode: RealtimeMode;
}) {
  const value = useRealtimeConnection(mode);
  return createElement(RealtimeContext.Provider, { value }, children);
}

export function RealtimeProvider({
  children,
  mode = 'full',
}: {
  children: ReactNode;
  mode?: RealtimeMode;
}) {
  const existing = useContext(RealtimeContext);
  if (existing) return createElement(Fragment, null, children);
  return createElement(RealtimeRootProvider, { mode }, children);
}

/** Consume the single realtime connection owned by the nearest provider. */
export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used within RealtimeProvider');
  return value;
}

/** Optionally consume the realtime connection if inside RealtimeProvider; returns null otherwise. */
export function useOptionalRealtime(): RealtimeContextValue | null {
  return useContext(RealtimeContext);
}
