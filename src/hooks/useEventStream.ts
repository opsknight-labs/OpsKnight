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

    if (!enabled) {
      return;
    }

    // Build query string
    const params = new URLSearchParams();
    if (incidentId) params.set('incidentId', incidentId);
    if (serviceId) params.set('serviceId', serviceId);

    const url = `/api/events/stream?${params.toString()}`;

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
      };

      eventSource.onmessage = event => {
        if (!isMountedRef.current) return;
        try {
          const parsed = JSON.parse(event.data);
          setData(parsed);
          onMessageRef.current?.(parsed);
        } catch (err) {
          logger.error('Failed to parse SSE message', { component: 'useEventStream', error: err });
        }
      };

      eventSource.onerror = _err => {
        if (!isMountedRef.current) return;
        setIsConnected(false);
        const connectionError = new Error('Event stream connection error');
        setError(connectionError);
        onErrorRef.current?.(connectionError);
        eventSource.close();

        // Attempt to reconnect after 3 seconds
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setupConnection();
          }
        }, 3000);
      };
    };

    setupConnection();

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
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
