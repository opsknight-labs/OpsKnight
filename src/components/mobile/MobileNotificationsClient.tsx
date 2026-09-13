'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, CalendarClock, Check, Server } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
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

const resolveNotificationHref = (notification: NotificationItem) => {
  if (notification.incidentId) return `/m/incidents/${notification.incidentId}`;
  if (notification.type === 'service') return '/m/services';
  if (notification.type === 'schedule') return '/m/schedules';
  return '/m';
};

const notificationType = {
  incident: {
    label: 'Incident',
    Icon: BellRing,
    tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300',
  },
  service: {
    label: 'Service',
    Icon: Server,
    tone: 'bg-blue-50 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300',
  },
  schedule: {
    label: 'On-call',
    Icon: CalendarClock,
    tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/35 dark:text-violet-300',
  },
} as const;

function NotificationSkeleton() {
  return (
    <div className="flex min-h-[76px] items-start gap-3 border-b border-border/70 px-3.5 py-3 last:border-b-0">
      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    </div>
  );
}

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
        if (showLoading) setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/notifications?unreadOnly=${unreadOnly}`);
        if (!response.ok) throw new Error('Failed to fetch notifications');
        const data = (await response.json()) as NotificationResponse;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
        setErrorMessage('');
      } catch (error) {
        logger.error('mobile.notifications.fetch_failed', {
          component: 'MobileNotificationsClient',
          error,
        });
        if (showLoading) setErrorMessage('Unable to load alerts.');
      } finally {
        if (showLoading) setLoading(false);
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
        if (cached?.notifications && Array.isArray(cached.notifications)) {
          setNotifications(cached.notifications);
          setUnreadCount(cached.unreadCount);
          setLoading(false);
        }
      }
    };
    void loadCache();
  }, []);

  useEffect(() => {
    void writeCache('mobile-notifications', {
      notifications,
      unreadCount,
      total: notifications.length,
    });
  }, [notifications, unreadCount]);

  const handleIncomingNotifications = useCallback(
    (incoming: NotificationItem[]) => {
      if (!incoming.length) return;
      const relevant = activeFilter === 'unread' ? incoming.filter(item => item.unread) : incoming;
      if (!relevant.length) return;
      setNotifications(previous => {
        const existingIds = new Set(previous.map(item => item.id));
        const fresh = relevant.filter(item => !existingIds.has(item.id));
        return fresh.length ? [...fresh, ...previous].slice(0, 50) : previous;
      });
      const unreadDelta = incoming.filter(item => item.unread).length;
      if (unreadDelta > 0) setUnreadCount(previous => previous + unreadDelta);
    },
    [activeFilter]
  );

  useNotificationStream({
    enabled: !usePolling,
    onNotifications: handleIncomingNotifications,
    onUnreadCount: count => setUnreadCount(count),
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
    const interval = window.setInterval(() => void fetchNotifications(false), 30000);
    return () => window.clearInterval(interval);
  }, [fetchNotifications, usePolling]);

  const queueOfflinePatch = async (body: object) => {
    await enqueueRequest({
      url: '/api/notifications',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const handleMarkAllRead = async () => {
    if (isUpdating || unreadCount === 0) return;
    haptics.tap();
    setIsUpdating(true);
    setErrorMessage('');
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    setNotifications(previous => previous.map(item => ({ ...item, unread: false })));
    setUnreadCount(0);

    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllAsRead: true }),
      });
      if (!response.ok) throw new Error('Failed to mark all as read');
    } catch (error) {
      logger.error('mobile.notifications.mark_all_failed', {
        component: 'MobileNotificationsClient',
        error,
      });
      if (typeof window !== 'undefined' && !navigator.onLine) {
        try {
          await queueOfflinePatch({ markAllAsRead: true });
          setErrorMessage('Offline. Mark-all is queued and waiting to sync.');
        } catch {
          setNotifications(previousNotifications);
          setUnreadCount(previousUnread);
          setErrorMessage('Unable to queue the update.');
        }
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
    setNotifications(previous =>
      previous.map(item => (item.id === notificationId ? { ...item, unread: false } : item))
    );
    setUnreadCount(previous => Math.max(0, previous - 1));

    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      if (!response.ok) throw new Error('Failed to mark as read');
    } catch (error) {
      logger.error('mobile.notifications.mark_failed', {
        component: 'MobileNotificationsClient',
        error,
      });
      if (typeof window !== 'undefined' && !navigator.onLine) {
        try {
          await queueOfflinePatch({ notificationIds: [notificationId] });
          setErrorMessage('Offline. Update queued and waiting to sync.');
        } catch {
          setNotifications(previousNotifications);
          setUnreadCount(previousUnread);
          setErrorMessage('Unable to queue the update.');
        }
      } else {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnread);
        setErrorMessage('Unable to update alert.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const filteredNotifications = useMemo(
    () =>
      activeFilter === 'unread'
        ? notifications.filter(notification => notification.unread)
        : notifications,
    [activeFilter, notifications]
  );

  const groupedNotifications = useMemo(() => {
    const groups = new Map<string, NotificationItem[]>();
    for (const notification of filteredNotifications) {
      const parsedDate = new Date(notification.createdAt);
      const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      const label = formatDayLabel(safeDate, userTimeZone);
      const bucket = groups.get(label) ?? [];
      bucket.push(notification);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [filteredNotifications, userTimeZone]);

  return (
    <div className="responsive-page space-y-4">
      <section className="flex min-h-10 items-center justify-between gap-3 px-0.5">
        <div className="inline-flex rounded-lg bg-muted p-0.5" aria-label="Alert filter">
          {(['all', 'unread'] as const).map(filter => (
            <button
              key={filter}
              type="button"
              onClick={() => {
                haptics.soft();
                setActiveFilter(filter);
              }}
              className={cn(
                'min-h-9 rounded-md px-3 text-[11px] font-semibold transition-colors',
                activeFilter === filter
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-pressed={activeFilter === filter}
            >
              {filter === 'all' ? 'All' : `Unread${unreadCount ? ` ${unreadCount}` : ''}`}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-2.5 text-[11px]"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0 || isUpdating}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Mark all read
        </Button>
      </section>

      {errorMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {errorMessage}
        </div>
      )}

      {loading ? (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none" data-testid="notifications-skeleton">
          <NotificationSkeleton />
          <NotificationSkeleton />
          <NotificationSkeleton />
        </Card>
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={<BellRing aria-hidden="true" />}
          title={activeFilter === 'unread' ? 'You are all caught up' : 'No alerts yet'}
          description="Incident updates and responder alerts will appear here."
          size="sm"
          action={
            <Button type="button" size="sm" onClick={() => router.push('/m/incidents')}>
              View incidents
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {groupedNotifications.map(group => (
            <section key={group.label} className="space-y-2">
              <h2 className="px-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {group.label}
              </h2>
              <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
                {group.items.map((notification, index) => {
                  const href = resolveNotificationHref(notification);
                  const meta = notificationType[notification.type];
                  const Icon = meta.Icon;
                  return (
                    <article
                      key={notification.id}
                      className={cn(
                        'relative flex min-w-0 items-start gap-3 px-3.5 py-3 transition-colors',
                        index > 0 && 'border-t border-border/70',
                        notification.unread && 'bg-primary/[0.025]'
                      )}
                    >
                      <button
                        type="button"
                        className="absolute inset-0 z-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => {
                          haptics.soft();
                          router.push(href);
                        }}
                        aria-label={`Open ${notification.title}`}
                      />

                      <span className={cn('relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', meta.tone)}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>

                      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
                        <div className="flex min-w-0 items-start gap-2">
                          <h3 className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug text-foreground">
                            {notification.title}
                          </h3>
                          {notification.unread && (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="Unread" />
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                          {notification.message}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                          <span>{meta.label}</span>
                          <span aria-hidden="true">·</span>
                          <MobileTime value={notification.createdAt} format="relative-short" />
                        </div>
                      </div>

                      {notification.unread && (
                        <button
                          type="button"
                          className="relative z-20 min-h-9 shrink-0 rounded-lg px-2 text-[10px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={event => {
                            event.stopPropagation();
                            void handleMarkRead(notification.id);
                          }}
                        >
                          Read
                        </button>
                      )}
                    </article>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
