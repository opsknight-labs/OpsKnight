'use client';

import { useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';

type NotificationStreamHandlers<T = unknown> = {
  enabled?: boolean;
  onNotifications?: (notifications: T[]) => void;
  onUnreadCount?: (count: number) => void;
  onError?: (error: Error) => void;
};

type Subscriber = {
  id: symbol;
  enabled: () => boolean;
  notifications: (items: unknown[]) => void;
  unread: (count: number) => void;
  error: (error: Error) => void;
  connection: (connected: boolean) => void;
};

const subscribers = new Map<symbol, Subscriber>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let browserListenersInstalled = false;

const supportsEventSource = () => typeof window !== 'undefined' && typeof EventSource !== 'undefined';
const canConnect = () =>
  supportsEventSource() &&
  subscribers.size > 0 &&
  !document.hidden &&
  (typeof navigator === 'undefined' || navigator.onLine);

function notifyConnection(connected: boolean) {
  for (const subscriber of subscribers.values()) {
    if (subscriber.enabled()) subscriber.connection(connected);
  }
}

function closeConnection() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  notifyConnection(false);
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  clearReconnectTimer();
  if (!canConnect()) return;
  reconnectAttempt += 1;
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt - 1, 5));
  const jittered = Math.max(500, Math.round(base * (0.65 + Math.random() * 0.7)));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, jittered);
}

function dispatchPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const data = payload as { type?: unknown; notifications?: unknown; count?: unknown };
  for (const subscriber of subscribers.values()) {
    if (!subscriber.enabled()) continue;
    if (data.type === 'notifications' && Array.isArray(data.notifications)) {
      subscriber.notifications(data.notifications);
    } else if (data.type === 'unread_count') {
      subscriber.unread(typeof data.count === 'number' ? Math.max(0, data.count) : 0);
    }
  }
}

function connect() {
  if (!canConnect() || eventSource) return;
  clearReconnectTimer();

  const source = new EventSource('/api/notifications/stream');
  eventSource = source;
  source.onopen = () => {
    if (eventSource !== source) return;
    reconnectAttempt = 0;
    notifyConnection(true);
  };
  source.onmessage = event => {
    if (eventSource !== source) return;
    try {
      dispatchPayload(JSON.parse(event.data));
    } catch (error) {
      logger.warn('notification.stream_payload_invalid', {
        component: 'useNotificationStream',
        error,
      });
    }
  };
  source.onerror = () => {
    if (eventSource !== source) return;
    const error = new Error('Notification stream temporarily unavailable');
    closeConnection();
    for (const subscriber of subscribers.values()) {
      if (subscriber.enabled()) subscriber.error(error);
    }
    scheduleReconnect();
  };
}

function reconcileConnection() {
  if (!canConnect()) {
    clearReconnectTimer();
    closeConnection();
    return;
  }
  connect();
}

function installBrowserListeners() {
  if (browserListenersInstalled || typeof window === 'undefined') return;
  browserListenersInstalled = true;
  const resume = () => {
    reconnectAttempt = 0;
    reconcileConnection();
  };
  const visibility = () => reconcileConnection();
  window.addEventListener('online', resume);
  window.addEventListener('offline', reconcileConnection);
  document.addEventListener('visibilitychange', visibility);
}

export function useNotificationStream<T = unknown>({
  enabled = true,
  onNotifications,
  onUnreadCount,
  onError,
}: NotificationStreamHandlers<T>) {
  const [isConnected, setIsConnected] = useState(false);
  const enabledRef = useRef(enabled);
  const handlersRef = useRef({ onNotifications, onUnreadCount, onError });

  useEffect(() => {
    enabledRef.current = enabled;
    handlersRef.current = { onNotifications, onUnreadCount, onError };
    reconcileConnection();
  }, [enabled, onNotifications, onUnreadCount, onError]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    installBrowserListeners();
    const id = Symbol('notification-stream-subscriber');
    subscribers.set(id, {
      id,
      enabled: () => enabledRef.current,
      notifications: items => handlersRef.current.onNotifications?.(items as T[]),
      unread: count => handlersRef.current.onUnreadCount?.(count),
      error: error => handlersRef.current.onError?.(error),
      connection: setIsConnected,
    });

    if (!supportsEventSource()) {
      handlersRef.current.onError?.(new Error('EventSource not supported'));
    } else {
      reconcileConnection();
    }

    return () => {
      subscribers.delete(id);
      if (subscribers.size === 0) {
        clearReconnectTimer();
        closeConnection();
        reconnectAttempt = 0;
      } else {
        reconcileConnection();
      }
    };
  }, []);

  return { isConnected, supported: supportsEventSource() };
}
