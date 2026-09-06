'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileCard from '@/components/mobile/MobileCard';
import { Skeleton } from '@/components/mobile/SkeletonLoader';
import { MobileEmptyIcon, MobileEmptyState } from '@/components/mobile/MobileUtils';
import { MobileFilterChip } from '@/components/mobile/MobileSearch';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDayLabel } from '@/lib/mobile-time';
import MobileTime from '@/components/mobile/MobileTime';
import { haptics } from '@/lib/haptics';
import { useNotificationStream } from '@/hooks/useNotificationStream';
import { enqueueRequest } from '@/lib/offline-queue';
import { readCache, writeCache } from '@/lib/mobile-cache';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  unread: boolean;
  type: 'incident' | 'service' | 'schedule';
  incidentId: string | null;
  createdAt: string;
};

type NotificationResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
  total: number;
};

const filters = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
];

const typeLabelMap = new Map<NotificationItem['type'], string>([
  ['incident', 'Incident'],
  ['service', 'Service'],
  ['schedule', 'Schedule'],
]);

const typeActionMap = new Map<NotificationItem['type'], string>([
  ['incident', 'Open'],
  ['service', 'Services'],
  ['schedule', 'Schedules'],
]);

const getTypeLabel = (type: NotificationItem['type']) => typeLabelMap.get(type) ?? 'Notification';
const getTypeAction = (type: NotificationItem['type']) => typeActionMap.get(type) ?? 'Open';

const resolveNotificationHref = (notification: NotificationItem) => {
  if (notification.incidentId) {
    return `/m/incidents/${notification.incidentId}`;
  }
  if (notification.type === 'service') {
    return '/m/services';
  }
  if (notification.type === 'schedule') {
    return '/m/schedules';
  }
  return '/m';
};

const NotificationSkeleton = () => (
  <MobileCard className="p-4">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--bg-secondary)]">
        <Skeleton width="18px" height="18px" borderRadius="6px" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton width="60%" height="14px" borderRadius="4px" />
          <Skeleton width="12px" height="12px" borderRadius="999px" />
        </div>
        <Skeleton width="90%" height="12px" borderRadius="4px" />
        <div className="flex items-center gap-2">
          <Skeleton width="80px" height="10px" borderRadius="4px" />
          <Skeleton width="40px" height="10px" borderRadius="4px" />
        </div>
      </div>
    </div>
    <div className="mt-3 flex gap-2">
      <Skeleton width="70px" height="24px" borderRadius="999px" />
      <Skeleton width="70px" height="24px" borderRadius="999px" />
    </div>
  </MobileCard>
);

export default function MobileNotificationsClient() {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [usePolling, setUsePolling] = useState(false);

  const fetchNotifications = useCallback(
    async (showLoading = true) => {
      const unreadOnly = activeFilter === 'unread';
      if (showLoading) {
        setLoading(true);
        setErrorMessage('');
      }
      if (typeof window !== 'undefined' && !navigator.onLine) {
        if (showLoading) {
          setLoading(false);
        }
        return;
      }
      try {
        const response = await fetch(`/api/notifications?unreadOnly=${unreadOnly}`);
        if (!response.ok) {
          throw new Error('Failed to fetch notifications');
        }
        const data = (await response.json()) as NotificationResponse;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
        setErrorMessage('');
      } catch (error) {
        logger.error('mobile.notifications.fetch_failed', {
          component: 'MobileNotificationsClient',
          error,
        });
        if (showLoading) {
          setErrorMessage('Unable to load notifications.');
        }
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [activeFilter]
  );

  useEffect(() => {
    void fetchNotifications(true);
  }, [fetchNotifications]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadCache = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<NotificationResponse>('mobile-notifications');
        if (
          cached &&
          cached.notifications &&
          Array.isArray(cached.notifications) &&
          cached.notifications.length > 0
        ) {
          setNotifications(cached.notifications);
          setUnreadCount(cached.unreadCount);
          setLoading(false);
        }
      }
    };
    void loadCache();
  }, []);

  useEffect(() => {
    void (async () => {
      await writeCache('mobile-notifications', {
        notifications,
        unreadCount,
        total: notifications.length,
      });
    })();
  }, [notifications, unreadCount]);

  const handleIncomingNotifications = useCallback(
    (incoming: NotificationItem[]) => {
      if (!incoming.length) return;
      const relevant = activeFilter === 'unread' ? incoming.filter(item => item.unread) : incoming;
      if (!relevant.length) return;
      setNotifications(prev => {
        const existingIds = new Set(prev.map(item => item.id));
        const fresh = relevant.filter(item => !existingIds.has(item.id));
        if (fresh.length === 0) return prev;
        return [...fresh, ...prev].slice(0, 50);
      });
      const unreadDelta = incoming.filter(item => item.unread).length;
      if (unreadDelta > 0) {
        setUnreadCount(prev => prev + unreadDelta);
      }
    },
    [activeFilter]
  );

  useNotificationStream({
    enabled: !usePolling,
    onNotifications: handleIncomingNotifications,
    onUnreadCount: count => setUnreadCount(count),
    // The stream hook already reconnects indefinitely with backoff. Only use
    // polling when EventSource is genuinely unsupported, not after a single
    // transient network failure.
    onError: () => {
      if (typeof EventSource === 'undefined') setUsePolling(true);
    },
  });

  useEffect(() => {
    const resumeStreaming = () => {
      if (typeof EventSource !== 'undefined') setUsePolling(false);
    };
    window.addEventListener('online', resumeStreaming);
    return () => window.removeEventListener('online', resumeStreaming);
  }, []);

  useEffect(() => {
    if (!usePolling) return;
    const interval = setInterval(() => {
      void fetchNotifications(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications, usePolling]);

  const handleMarkAllRead = async () => {
    if (isUpdating || unreadCount === 0) return;
    haptics.tap();
    setIsUpdating(true);
    setErrorMessage('');
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    setNotifications(prev => prev.map(item => ({ ...item, unread: false })));
    setUnreadCount(0);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllAsRead: true }),
      });
      if (!response.ok) {
        throw new Error('Failed to mark all as read');
      }
    } catch (error) {
      logger.error('mobile.notifications.mark_all_failed', {
        component: 'MobileNotificationsClient',
        error,
      });
      if (typeof window !== 'undefined' && !navigator.onLine) {
        try {
          await enqueueRequest({
            url: '/api/notifications',
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markAllAsRead: true }),
          });
        } catch {
          // Ignore queue failures
        }
        setErrorMessage('Offline. Mark-all queued and will sync automatically.');
      } else {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnread);
        setErrorMessage('Unable to mark all as read.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    if (isUpdating) return;
    haptics.tap();
    setIsUpdating(true);
    setErrorMessage('');
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    setNotifications(prev =>
      prev.map(item => (item.id === notificationId ? { ...item, unread: false } : item))
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      if (!response.ok) {
        throw new Error('Failed to mark as read');
      }
    } catch (error) {
      logger.error('mobile.notifications.mark_failed', {
        component: 'MobileNotificationsClient',
        error,
      });
      if (typeof window !== 'undefined' && !navigator.onLine) {
        try {
          await enqueueRequest({
            url: '/api/notifications',
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notificationIds: [notificationId] }),
          });
        } catch {
          // Ignore queue failures
        }
        setErrorMessage('Offline. Update queued and will sync automatically.');
      } else {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnread);
        setErrorMessage('Unable to update notification.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const emptyMessage = useMemo(() => {
    if (activeFilter === 'unread') {
      return 'You are all caught up.';
    }
    return 'No notifications yet.';
  }, [activeFilter]);

  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'unread') {
      return notifications.filter(notification => notification.unread);
    }
    return notifications;
  }, [activeFilter, notifications]);

  const groupedNotifications = useMemo(() => {
    const groups = new Map<string, NotificationItem[]>();

    filteredNotifications.forEach(notification => {
      const parsedDate = new Date(notification.createdAt);
      const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      const label = formatDayLabel(safeDate, userTimeZone);
      const bucket = groups.get(label) ?? [];
      if (!groups.has(label)) {
        groups.set(label, bucket);
      }
      bucket.push(notification);
    });

    return Array.from(groups.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [filteredNotifications, userTimeZone]);

  const iconTone = (type: NotificationItem['type']) => {
    switch (type) {
      case 'incident':
        return 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400';
      case 'service':
        return 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400';
      case 'schedule':
        return 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400';
      default:
        return 'bg-[color:var(--bg-secondary)] text-[color:var(--text-muted)]';
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
            Notifications
          </h1>
          <p className="mt-0.5 text-xs font-medium text-[color:var(--text-muted)]">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0 || isUpdating}
        >
          Mark all read
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]">
        {filters.map(filter => (
          <MobileFilterChip
            key={filter.value}
            label={filter.label}
            active={activeFilter === filter.value}
            onClick={() => {
              haptics.soft();
              setActiveFilter(filter.value as 'all' | 'unread');
            }}
          />
        ))}
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" data-testid="notifications-skeleton">
          <NotificationSkeleton />
          <NotificationSkeleton />
          <NotificationSkeleton />
        </div>
      ) : filteredNotifications.length === 0 ? (
        <MobileEmptyState
          icon={<MobileEmptyIcon />}
          title={emptyMessage}
          description="Incident updates and alerts show up here."
          action={
            <>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition active:scale-[0.98]"
                onClick={() => {
                  haptics.tap();
                  router.push('/m/incidents');
                }}
              >
                View incidents
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[color:var(--text-secondary)] transition active:scale-[0.98]"
                onClick={() => {
                  haptics.tap();
                  router.push('/m/services');
                }}
              >
                Check services
              </button>
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groupedNotifications.map(group => (
            <div key={group.label} className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                {group.label}
              </div>
              <div className="flex flex-col gap-2">
                {group.items.map(notification => {
                  const href = resolveNotificationHref(notification);
                  const typeLabel = getTypeLabel(notification.type);
                  const typeAction = getTypeAction(notification.type);
                  return (
                    <MobileCard
                      key={notification.id}
                      className={notification.unread ? 'ring-1 ring-primary/20' : undefined}
                      onClick={
                        href
                          ? () => {
                              haptics.soft();
                              router.push(href);
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold',
                            iconTone(notification.type)
                          )}
                        >
                          {typeLabel.charAt(0)}
                        </div>
                        <div className="flex flex-1 flex-col gap-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-[color:var(--text-primary)]">
                              {notification.title}
                            </span>
                            {notification.unread && (
                              <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            {notification.message}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] font-medium text-[color:var(--text-muted)]">
                            <span>{typeLabel}</span>
                            <span>•</span>
                            <MobileTime value={notification.createdAt} format="relative-short" />
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {href && (
                          <button
                            type="button"
                            className="rounded-full border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-1 text-[11px] font-semibold text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-secondary)]"
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              haptics.soft();
                              router.push(href);
                            }}
                          >
                            {typeAction}
                          </button>
                        )}
                        {notification.unread && (
                          <button
                            type="button"
                            className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-primary/90"
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleMarkRead(notification.id);
                            }}
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </MobileCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
