'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import type { WidgetDataContext } from '@/lib/widget-data-provider';

const WidgetContext = createContext<WidgetDataContext | null>(null);

interface WidgetProviderProps {
  children: ReactNode;
  initialData: WidgetDataContext;
}

// Reconnection configuration
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_BACKOFF_MULTIPLIER = 2;
const MAX_RECONNECT_ATTEMPTS = 10;

interface ConnectionState {
  isConnected: boolean;
  error: string | null;
  reconnectAttempts: number;
}

/**
 * Widget Data Provider with SSE for Real-time Updates
 * Features:
 * - Exponential backoff for reconnection
 * - Memory leak prevention
 * - Graceful degradation on connection failure
 * - Proper cleanup on unmount
 */
export function WidgetProvider({ children, initialData }: WidgetProviderProps) {
  const [data, setData] = useState<WidgetDataContext>(initialData);
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isConnected: false,
    error: null,
    reconnectAttempts: 0,
  });

  // Refs for cleanup and state management
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const reconnectAttemptsRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});

  /**
   * Cleans up SSE connection and timers
   */
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  /**
   * Establishes SSE connection with retry logic
   * Uses a stable ref pattern to avoid circular dependencies
   */
  const connect = useCallback(() => {
    // Don't connect if unmounted or already connected
    if (!isMountedRef.current) return;
    if (eventSourceRef.current?.readyState === EventSource.OPEN) return;

    // Cleanup any existing connection
    cleanup();

    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const streamUrl = search ? `/api/widgets/stream${search}` : '/api/widgets/stream';
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!isMountedRef.current) {
          eventSource.close();
          return;
        }

        // Reset reconnection state on successful connection
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        reconnectAttemptsRef.current = 0;
        setConnectionState({
          isConnected: true,
          error: null,
          reconnectAttempts: 0,
        });
      };

      eventSource.onmessage = event => {
        if (!isMountedRef.current) return;

        try {
          const newData = JSON.parse(event.data);

          // Safely parse lastUpdated date
          const lastUpdated = newData.lastUpdated ? new Date(newData.lastUpdated) : new Date();

          // Validate the date
          const validLastUpdated = isNaN(lastUpdated.getTime()) ? new Date() : lastUpdated;

          setData(prevData => ({
            ...prevData,
            ...newData,
            lastUpdated: validLastUpdated,
          }));
        } catch (err) {
          console.error('[WidgetProvider] Failed to parse SSE data:', err);
        }
      };

      eventSource.onerror = () => {
        if (!isMountedRef.current) {
          eventSource.close();
          return;
        }

        eventSource.close();
        eventSourceRef.current = null;

        reconnectAttemptsRef.current += 1;
        const currentAttempts = reconnectAttemptsRef.current;

        if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
          setConnectionState({
            isConnected: false,
            error: 'Connection failed. Please refresh the page.',
            reconnectAttempts: currentAttempts,
          });
        } else {
          setConnectionState({
            isConnected: false,
            error: `Connection lost. Reconnecting... (${currentAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
            reconnectAttempts: currentAttempts,
          });

          // Schedule reconnection with exponential backoff (inline to avoid circular deps)
          const delay = Math.min(reconnectDelayRef.current, MAX_RECONNECT_DELAY_MS);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              reconnectDelayRef.current *= RECONNECT_BACKOFF_MULTIPLIER;
              connectRef.current();
            }
          }, delay);
        }
      };
    } catch (err) {
      console.error('[WidgetProvider] Failed to establish SSE connection:', err);
      setConnectionState({
        isConnected: false,
        error: 'Failed to connect to real-time updates',
        reconnectAttempts: 0,
      });
    }
  }, [cleanup]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Initialize connection on mount
  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  // Handle visibility change - reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !connectionState.isConnected) {
        // Reset backoff and attempt reconnection when tab becomes visible
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        reconnectAttemptsRef.current = 0;
        setConnectionState(prev => ({
          ...prev,
          reconnectAttempts: 0,
        }));
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connectionState.isConnected, connect]);

  return (
    <WidgetContext.Provider value={data}>
      {connectionState.error && (
        <div
          style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1rem',
            padding: '0.75rem 1rem',
            background:
              connectionState.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
                ? 'rgba(239, 68, 68, 0.95)'
                : 'rgba(245, 158, 11, 0.95)',
            color: 'white',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: '500',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            maxWidth: '320px',
          }}
          role="alert"
          aria-live="polite"
        >
          {connectionState.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && (
            <div
              style={{
                width: '14px',
                height: '14px',
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
              aria-hidden="true"
            />
          )}
          <span>{connectionState.error}</span>
        </div>
      )}
      {children}
    </WidgetContext.Provider>
  );
}

/**
 * Hook to access widget data in child components
 * @throws Error if used outside of WidgetProvider
 */
export function useWidgetData(): WidgetDataContext {
  const context = useContext(WidgetContext);
  if (!context) {
    throw new Error('useWidgetData must be used within WidgetProvider');
  }
  return context;
}
