'use client';

import { useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';

type EventStreamOptions = {
  incidentId?: string;
  serviceId?: string;
  enabled?: boolean;
  onMessage?: (data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  onError?: (error: Error) => void;
};

/**
 * React hook for subscribing to Server-Sent Events (SSE) stream
 *
 * @example
 * const { data, isConnected } = useEventStream({
 *   incidentId: 'inc_123',
 *   onMessage: (data) => logger.info('Update', { data }),
 * });
 */
export function useEventStream(options: EventStreamOptions = {}) {
  const { incidentId, serviceId, enabled = true, onMessage, onError } = options;
  const [data, setData] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const authorizationRevokedRef = useRef(false);

  // Use refs for callbacks to avoid re-creating EventSource on callback changes
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    isMountedRef.current = true;
    authorizationRevokedRef.current = false;

    if (!enabled) {
      return;
    }

    // Build query string
    const params = new URLSearchParams();
    if (incidentId) params.set('incidentId', incidentId);
    if (serviceId) params.set('serviceId', serviceId);

    const url = `/api/events/stream?${params.toString()}`;

    const reconnectAttemptsRef = { current: 0 };

    const setupConnection = () => {
      if (!isMountedRef.current) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Create EventSource connection
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!isMountedRef.current) return;
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = event => {
        if (!isMountedRef.current) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.type === 'authorization_revoked') {
            authorizationRevokedRef.current = true;
            eventSource.close();
            eventSourceRef.current = null;
            setIsConnected(false);
            const revokedError = new Error('Event stream authorization was revoked.');
            setError(revokedError);
            onErrorRef.current?.(revokedError);
            return;
          }
          setData(parsed);
          onMessageRef.current?.(parsed);
        } catch (err) {
          logger.error('Failed to parse SSE message', { component: 'useEventStream', error: err });
        }
      };

      eventSource.onerror = _err => {
        if (!isMountedRef.current || authorizationRevokedRef.current) return;
        setIsConnected(false);
        const connectionError = new Error('Event stream connection error');
        setError(connectionError);
        onErrorRef.current?.(connectionError);
        eventSource.close();

        // Attempt to reconnect with exponential backoff and jitter (1s to 30s)
        const delay = Math.min(
          30000,
          Math.floor(
            1000 * Math.pow(1.5, reconnectAttemptsRef.current) * (0.8 + Math.random() * 0.4)
          )
        );
        reconnectAttemptsRef.current++;

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setupConnection();
          }
        }, delay);
      };
    };

    setupConnection();

    const handleOnline = () => {
      if (!authorizationRevokedRef.current) setupConnection();
    };
    window.addEventListener('online', handleOnline);

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [incidentId, serviceId, enabled]);

  return { data, isConnected, error };
}
