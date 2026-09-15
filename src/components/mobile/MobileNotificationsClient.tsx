'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, CalendarClock, Check, Server } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
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
import { fetchWithTimeout } from '@/lib/client-timeout';
import { enqueueRequest } from '@/lib/offline-queue';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import { appRoutes } from '@/lib/app-routes';

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

type Filter = 'all' | 'unread';

const resolveNotificationHref = (notification: NotificationItem) => {
  if (notification.incidentId) return appRoutes.incident('mobile', notification.incidentId);
  if (notification.type === 'service') return appRoutes.services('mobile');
  if (notification.type === 'schedule') return appRoutes.schedules('mobile');
  return appRoutes.home('mobile');
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
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState('');
  const [pollingRequired, setPollingRequired] = useState(
    () => typeof window !== 'undefined' && typeof EventSource === 'undefined'
  );
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const cacheKey = `mobile-notifications:${activeFilter}`;

  const fetchNotifications = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setLoading(true);
        setErrorMessage('');
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await readCache<NotificationResponse>(cacheKey);
        const status = readMobileCacheStatus(cacheKey);
        if (cached?.notifications && Array.isArray(cached.notifications)) {
          setNotifications(cached.notifications);
          setUnreadCount(cached.unreadCount);
          setCachedAt(status?.savedAt ?? null);
        } else {
          setNotifications([]);
          setErrorMessage('Offline. No saved alerts are available for this filter.');
        }
        setLoading(false);
        return;
      }

      try {
        const response = await fetchWithTimeout(
          `/api/notifications?unreadOnly=${activeFilter === 'unread'}`,
          { cache: 'no-store' },
          12_000
        );
        if (response?.status === 401) {
          if (typeof window !== 'undefined') {
            const callback = `${window.location.pathname}${window.location.search}`;
            router.push(appRoutes.login('mobile', callback));
          }
          return;
        }
        if (!response?.ok)
          throw new Error(`Notifications returned HTTP ${response?.status ?? 'error'}`);
        const data = (await response.json()) as NotificationResponse;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
        setCachedAt(null);
        setErrorMessage('');
        await writeCache(cacheKey, data);
      } catch (error) {
        logger.warn('mobile.notifications.fetch_failed', {
          component: 'MobileNotificationsClient',
          error,
        });
        if (showLoading) setErrorMessage('Unable to load alerts.');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [activeFilter, cacheKey]
  );

  useEffect(() => {
    void fetchNotifications(true);
  }, [fetchNotifications]);

  const handleIncomingNotifications = useCallback(
    (incoming: NotificationItem[]) => {
      if (!incoming.length) return;
      const relevant = activeFilter === 'unread' ? incoming.filter(item => item.unread) : incoming;
      if (relevant.length) {
        setNotifications(previous => {
          const existingIds = new Set(previous.map(item => item.id));
          return [...relevant.filter(item => !existingIds.has(item.id)), ...previous].slice(0, 50);
        });
      }
      setUnreadCount(count => Math.max(count, incoming.filter(item => item.unread).length));
    },
    [activeFilter]
  );

  useNotificationStream({
    onNotifications: handleIncomingNotifications,
    onUnreadCount: setUnreadCount,
    onError: error => {
      if (/not supported/i.test(error.message)) setPollingRequired(true);
    },
  });

  useEffect(() => {
    if (!pollingRequired) return;
    let interval: number | null = null;
    const start = () => {
      if (interval !== null || document.hidden) return;
      interval = window.setInterval(() => void fetchNotifications(false), 30_000);
    };
    const stop = () => {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    };
    const visibility = () => {
      if (document.hidden) stop();
      else {
        void fetchNotifications(false);
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [fetchNotifications, pollingRequired]);

  const queueOfflinePatch = async (body: object) => {
    const id = await enqueueRequest({
      operation: 'NOTIFICATION_STATE',
      url: '/api/notifications',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!id) throw new Error('Offline queue unavailable');
  };

  const handleMarkAllRead = async () => {
    if (markingAll || unreadCount === 0) return;
    haptics.tap();
    setMarkingAll(true);
    setErrorMessage('');
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    setNotifications(previous => previous.map(item => ({ ...item, unread: false })));
    setUnreadCount(0);

    try {
      const response = await fetchWithTimeout(
        '/api/notifications',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markAllAsRead: true }),
        },
        12_000
      );
      if (response?.status === 401) {
        if (typeof window !== 'undefined') {
          const callback = `${window.location.pathname}${window.location.search}`;
          router.push(appRoutes.login('mobile', callback));
        }
        return;
      }
      if (!response?.ok) throw new Error(`Mark-all returned HTTP ${response?.status ?? 'error'}`);
      if (navigator.onLine) void fetchNotifications(false);
    } catch (error) {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnread);
      if (!navigator.onLine) {
        try {
          await queueOfflinePatch({ markAllAsRead: true });
          setErrorMessage(
            'Offline. Mark-all is queued, but the alerts remain unread until OpsKnight confirms it.'
          );
        } catch {
          setErrorMessage('Unable to queue mark-all. Nothing was changed.');
        }
      } else {
        logger.warn('mobile.notifications.mark_all_failed', {
          component: 'MobileNotificationsClient',
          error,
        });
        setErrorMessage('Unable to mark all alerts as read. Nothing was changed.');
      }
    } finally {
      setMarkingAll(false);
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    if (updatingIds.has(notificationId)) return;
    setUpdatingIds(current => new Set(current).add(notificationId));
    setErrorMessage('');
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    setNotifications(previous =>
      previous.map(item => (item.id === notificationId ? { ...item, unread: false } : item))
    );
    setUnreadCount(previous => Math.max(0, previous - 1));

    try {
      const response = await fetchWithTimeout(
        '/api/notifications',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationIds: [notificationId] }),
        },
        12_000
      );
      if (response?.status === 401) {
        if (typeof window !== 'undefined') {
          const callback = `${window.location.pathname}${window.location.search}`;
          router.push(appRoutes.login('mobile', callback));
        }
        return;
      }
      if (!response?.ok) throw new Error(`Mark-read returned HTTP ${response?.status ?? 'error'}`);
    } catch (error) {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnread);
      if (!navigator.onLine) {
        try {
          await queueOfflinePatch({ notificationIds: [notificationId] });
          setErrorMessage(
            'Offline. Read-state update is queued and will change only after server confirmation.'
          );
        } catch {
          setErrorMessage('Unable to queue the update. Nothing was changed.');
        }
      } else {
        logger.warn('mobile.notifications.mark_failed', {
          component: 'MobileNotificationsClient',
          error,
          notificationId,
        });
        setErrorMessage('Unable to update the alert. Nothing was changed.');
      }
    } finally {
      setUpdatingIds(current => {
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
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
      <MobileCachedDataNotice savedAt={cachedAt} />
      <section className="flex min-h-11 items-center justify-between gap-3 px-0.5">
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
                'min-h-11 rounded-md px-3 text-[11px] font-semibold transition-colors',
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
          className="min-h-11 px-2.5 text-[11px]"
          onClick={() => void handleMarkAllRead()}
          disabled={unreadCount === 0 || markingAll}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {markingAll ? 'Updating…' : 'Mark all read'}
        </Button>
      </section>

      {errorMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {errorMessage}
        </div>
      ) : null}

      {loading ? (
        <Card
          className="overflow-hidden rounded-xl border-border bg-card shadow-none"
          data-testid="notifications-skeleton"
        >
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
            <Button type="button" size="sm" asChild>
              <Link href={appRoutes.incidents('mobile')}>View incidents</Link>
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
                  const meta = notificationType[notification.type];
                  const Icon = meta.Icon;
                  return (
                    <article
                      key={notification.id}
                      className={cn(
                        'flex min-w-0 items-stretch transition-colors',
                        index > 0 && 'border-t border-border/70',
                        notification.unread && 'bg-primary/[0.025]'
                      )}
                    >
                      <Link
                        href={resolveNotificationHref(notification)}
                        onClick={() => haptics.soft()}
                        className="flex min-h-[76px] min-w-0 flex-1 items-start gap-3 px-3.5 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            meta.tone
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-start gap-2">
                            <span className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug text-foreground">
                              {notification.title}
                            </span>
                            {notification.unread ? (
                              <span
                                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500"
                                aria-label="Unread"
                              />
                            ) : null}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">
                            {notification.message}
                          </span>
                          <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                            <span>{meta.label}</span>
                            <span aria-hidden="true">·</span>
                            <MobileTime value={notification.createdAt} format="relative-short" />
                          </span>
                        </span>
                      </Link>
                      {notification.unread ? (
                        <button
                          type="button"
                          className="min-h-11 min-w-11 shrink-0 self-center rounded-lg px-2 text-[10px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                          disabled={updatingIds.has(notification.id)}
                          onClick={() => void handleMarkRead(notification.id)}
                          aria-label={`Mark ${notification.title} as read`}
                        >
                          {updatingIds.has(notification.id) ? '…' : 'Read'}
                        </button>
                      ) : null}
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
