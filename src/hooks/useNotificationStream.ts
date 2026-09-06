'use client';

import { useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';

type NotificationStreamHandlers<T = any> = {
  enabled?: boolean;
  onNotifications?: (notifications: T[]) => void;
  onUnreadCount?: (count: number) => void;
  onError?: (error: Error) => void;
};

export function useNotificationStream<T = any>({
  enabled = true,
  onNotifications,
  onUnreadCount,
  onError,
}: NotificationStreamHandlers<T>) {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const handlersRef = useRef({ onNotifications, onUnreadCount, onError });

  useEffect(() => {
    handlersRef.current = { onNotifications, onUnreadCount, onError };
  }, [onNotifications, onUnreadCount, onError]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return;
    if (typeof EventSource === 'undefined') {
      handlersRef.current.onError?.(new Error('EventSource not supported'));
      return;
    }

    let retryDelay = 2000;

    const setupConnection = () => {
      if (!isMountedRef.current) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource('/api/notifications/stream');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!isMountedRef.current) return;
        setIsConnected(true);
        retryDelay = 2000;
      };

      eventSource.onmessage = event => {
        if (!isMountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'notifications' && Array.isArray(data.notifications)) {
            handlersRef.current.onNotifications?.(data.notifications);
          }
          if (data.type === 'unread_count') {
            handlersRef.current.onUnreadCount?.(data.count || 0);
          }
        } catch (error) {
          logger.error('useNotificationStream.parse', {
            component: 'useNotificationStream',
            error,
          });
        }
      };

      eventSource.onerror = () => {
        if (!isMountedRef.current) return;
        setIsConnected(false);
        const error = new Error('Notification stream connection error');
        handlersRef.current.onError?.(error);
        eventSource.close();

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            retryDelay = Math.min(retryDelay * 1.5, 30000);
            setupConnection();
          }
        }, retryDelay);
      };
    };

    setupConnection();

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
  }, [enabled]);

  return { isConnected };
}
