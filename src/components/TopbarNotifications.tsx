'use client';

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useModalState } from '@/hooks/useModalState';
import { logger } from '@/lib/logger';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import { Button } from '@/components/ui/shadcn/button';
import {
  Bell,
  CheckCheck,
  Check,
  CheckCircle2,
  Archive,
  Settings2,
  AlertTriangle,
  Server,
  CalendarClock,
  ArrowRight,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { cn } from '@/lib/utils';

type Notification = {
  id: string;
  title: string;
  message: string;
  time: string;
  unread: boolean;
  type: 'incident' | 'service' | 'schedule';
  incidentId?: string;
  channel?: string;
  createdAt?: string;
};

interface NotificationListProps {
  items: Notification[];
  emptyMessage?: string;
  emptySub?: string;
  onNavigate: (incidentId?: string) => void;
  onMarkAsRead: (id: string, e: React.MouseEvent) => void;
}

const NotificationList = memo(function NotificationList({
  items,
  emptyMessage = 'No notifications',
  emptySub = 'You are all caught up!',
  onNavigate,
  onMarkAsRead,
}: NotificationListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 flex items-center justify-center mb-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-0.5">
          {emptyMessage}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptySub}</p>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-3.5 space-y-2.5">
      {items.map(notification => {
        const isIncident = notification.type === 'incident';
        const isService = notification.type === 'service';
        const isSchedule = notification.type === 'schedule';

        return (
          <div
            key={notification.id}
            className={cn(
              'group relative flex items-start gap-3 p-3 rounded-xl border text-left transition-all duration-150 shadow-2xs cursor-pointer',
              notification.unread
                ? isIncident
                  ? 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-rose-200 dark:border-rose-900/40 border-l-[3.5px] border-l-rose-500 hover:border-rose-300 dark:hover:border-rose-800/60 hover:shadow-xs'
                  : isService
                    ? 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-blue-200 dark:border-blue-900/40 border-l-[3.5px] border-l-blue-500 hover:border-blue-300 dark:hover:border-blue-800/60 hover:shadow-xs'
                    : 'bg-white dark:bg-zinc-900 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/60 border-purple-200 dark:border-purple-900/40 border-l-[3.5px] border-l-purple-500 hover:border-purple-300 dark:hover:border-purple-800/60 hover:shadow-xs'
                : 'bg-white/80 dark:bg-zinc-900/60 hover:bg-white dark:hover:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-800/80 border-l-[3.5px] border-l-zinc-300 dark:border-l-zinc-700 opacity-85 hover:opacity-100'
            )}
            onClick={() => {
              if (notification.incidentId) {
                onNavigate(notification.incidentId);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ' ') && notification.incidentId) {
                onNavigate(notification.incidentId);
              }
            }}
          >
            {/* Type Icon */}
            <div className="mt-0.5 shrink-0">
              {isIncident && (
                <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shadow-2xs">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              )}
              {isService && (
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-2xs">
                  <Server className="h-4 w-4" />
                </div>
              )}
              {isSchedule && (
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shadow-2xs">
                  <CalendarClock className="h-4 w-4" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={cn(
                      'text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border leading-none shrink-0',
                      isIncident
                        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30'
                        : isService
                          ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30'
                          : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/30'
                    )}
                  >
                    {isIncident ? 'Incident' : isService ? 'Service' : 'Shift'}
                  </span>
                  <p
                    className={cn(
                      'text-xs font-semibold leading-snug truncate',
                      notification.unread
                        ? 'text-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-700 dark:text-zinc-300'
                    )}
                  >
                    {notification.title}
                  </p>
                </div>
                {notification.unread && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 bg-rose-500" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                  </span>
                )}
              </div>
              <p
                className={cn(
                  'text-xs line-clamp-2 leading-relaxed',
                  notification.unread
                    ? 'text-zinc-600 dark:text-zinc-400'
                    : 'text-zinc-500 dark:text-zinc-500'
                )}
              >
                {notification.message}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 font-mono">
                  {notification.time}
                </span>
                {notification.incidentId && (
                  <span
                    className={cn(
                      'text-[11px] font-medium inline-flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform',
                      isIncident
                        ? 'text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300'
                        : isService
                          ? 'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                          : 'text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300'
                    )}
                  >
                    View incident <ArrowRight className="h-3 w-3" />
                  </span>
                )}
              </div>
            </div>

            {/* Inline Mark As Read on Hover */}
            {notification.unread && (
              <button
                type="button"
                title="Mark as read"
                onClick={e => onMarkAsRead(notification.id, e)}
                className="opacity-0 group-hover:opacity-100 absolute top-2.5 right-2.5 p-1 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 shadow-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-all duration-150 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default function TopbarNotifications() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useModalState('notifications');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/notifications?limit=50');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      } else {
        logger.error('Failed to fetch notifications', {
          component: 'TopbarNotifications',
          status: response.status,
        });
      }
    } catch (error) {
      logger.error('Error fetching notifications', { component: 'TopbarNotifications', error });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Set up SSE connection for real-time updates
    const eventSource = new EventSource('/api/notifications/stream');

    eventSource.onopen = () => {
      setIsLive(true);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    eventSource.onmessage = event => {
      try {
        setIsLive(true);
        const data = JSON.parse(event.data);

        if (data.type === 'notifications' && data.notifications) {
          setNotifications(prev => {
            const existingIds = new Set(prev.map(n => n.id));
            const newNotifications = data.notifications.filter(
              (n: Notification) => !existingIds.has(n.id)
            );
            return [...newNotifications, ...prev].slice(0, 50);
          });
        }

        if (data.type === 'unread_count') {
          setUnreadCount(data.count || 0);
        }
      } catch (error) {
        logger.error('Error parsing SSE message', { component: 'TopbarNotifications', error });
      }
    };

    eventSource.onerror = error => {
      logger.error('SSE connection error', { component: 'TopbarNotifications', error });
      setIsLive(false);
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(fetchNotifications, 30000);
      }
      eventSource.close();
    };

    return () => {
      eventSource.close();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    setNotifications(prev =>
      prev.map(notification =>
        notification.unread ? { ...notification, unread: false } : notification
      )
    );
    setUnreadCount(0);
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllAsRead: true }),
      });
    } catch (error) {
      logger.error('Error marking all as read', { component: 'TopbarNotifications', error });
      fetchNotifications();
    }
  }, [unreadCount, fetchNotifications]);

  const markAsRead = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, unread: false } : n)));
      setUnreadCount(prev => Math.max(0, prev - 1));
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationIds: [id] }),
        });
      } catch (error) {
        logger.error('Error marking as read', { component: 'TopbarNotifications', error });
        fetchNotifications();
      }
    },
    [fetchNotifications]
  );

  const onNavigate = useCallback(
    (incidentId?: string) => {
      if (!incidentId) return;
      const isMobileContext = pathname?.startsWith('/m');
      const targetUrl = isMobileContext ? `/m/incidents/${incidentId}` : `/incidents/${incidentId}`;
      setOpen(false);
      router.push(targetUrl);
    },
    [pathname, router, setOpen]
  );

  const unreadNotifications = useMemo(() => notifications.filter(n => n.unread), [notifications]);
  const incidentNotifications = useMemo(
    () => notifications.filter(n => n.type === 'incident'),
    [notifications]
  );
  const scheduleNotifications = useMemo(
    () => notifications.filter(n => n.type === 'schedule'),
    [notifications]
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-0 left-[19px] flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none bg-rose-600 text-white ring-2 ring-[#09090b] shadow-xs tabular-nums select-none pointer-events-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 bg-zinc-50 dark:bg-zinc-950 text-foreground border-l border-zinc-200 dark:border-zinc-800 shadow-2xl [&>button]:z-50 [&>button]:cursor-pointer [&>button]:text-zinc-400 [&>button]:hover:text-white [&>button]:top-4 [&>button]:right-4.5 [&>button]:rounded-md [&>button]:p-1.5 [&>button]:hover:bg-white/10 [&>button]:transition-colors overflow-hidden">
        <div className="relative px-5 pt-4 pb-3 bg-gradient-to-b from-[#18181b] via-[#121216] to-[#09090b] text-white border-b border-zinc-800/80 shadow-2xs">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_60%)] pointer-events-none" />
          <SheetHeader className="p-0 space-y-0 text-left">
            {/* Top row: Bell Icon + Title + Live badge. Leaves right side completely clear for X button */}
            <div className="flex items-center justify-between pr-12">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/10 border border-zinc-700/60 shadow-xs backdrop-blur-md shrink-0">
                  <Bell className="h-4 w-4 text-white" />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <SheetTitle className="text-base font-bold tracking-tight text-white m-0 truncate">
                    Notifications
                  </SheetTitle>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border leading-none shrink-0',
                      isLive
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                        : 'text-zinc-400 bg-zinc-800/80 border-zinc-700/60'
                    )}
                  >
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        isLive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                      )}
                    />
                    {isLive ? 'Live' : 'Polling'}
                  </span>
                </div>
              </div>
            </div>

            {/* Second row: Subtitle + Action Toolbar (Mark all read) - completely clear of X close button */}
            <div className="relative z-10 flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-zinc-800/50">
              <p className="text-[11.5px] text-zinc-400 truncate">
                Incident alerts & schedule changes
              </p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="text-[11.5px] h-6 px-2 text-zinc-300 hover:text-white bg-zinc-800/90 hover:bg-zinc-700/90 border border-zinc-700/70 rounded-md font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-2xs"
                  onClick={markAllRead}
                >
                  <CheckCheck className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Mark all read</span>
                </button>
              ) : (
                <span className="text-[11px] text-zinc-500 font-mono inline-flex items-center gap-1 shrink-0">
                  <Check className="h-3 w-3 text-emerald-400/80" />
                  All caught up
                </span>
              )}
            </div>

            <SheetDescription className="sr-only">
              Recent activity, incident alerts, and schedule changes.
            </SheetDescription>
          </SheetHeader>
        </div>

        <Tabs
          defaultValue="all"
          className="flex-1 flex flex-col overflow-hidden bg-zinc-50/50 dark:bg-zinc-950"
        >
          <div className="px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-zinc-200/80 dark:border-zinc-800/80">
            <TabsList className="w-full grid grid-cols-4 h-8 p-0.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800/80 rounded-lg">
              <TabsTrigger
                value="all"
                className="text-[11px] font-semibold py-1 text-zinc-600 dark:text-zinc-400 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="text-[11px] font-semibold py-1 gap-1 text-zinc-600 dark:text-zinc-400 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
              >
                Unread
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30 text-[10px] font-bold">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="incident"
                className="text-[11px] font-semibold py-1 text-zinc-600 dark:text-zinc-400 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
              >
                Incidents
              </TabsTrigger>
              <TabsTrigger
                value="schedule"
                className="text-[11px] font-semibold py-1 text-zinc-600 dark:text-zinc-400 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
              >
                Shifts
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-950">
            {loading ? (
              <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mr-2" />
                Loading notifications...
              </div>
            ) : (
              <>
                <TabsContent value="all" className="m-0 border-0 h-full">
                  <NotificationList
                    items={notifications}
                    onNavigate={onNavigate}
                    onMarkAsRead={markAsRead}
                  />
                </TabsContent>
                <TabsContent value="unread" className="m-0 border-0 h-full">
                  <NotificationList
                    items={unreadNotifications}
                    onNavigate={onNavigate}
                    onMarkAsRead={markAsRead}
                    emptyMessage="No unread notifications"
                    emptySub="You're caught up with all your alerts"
                  />
                </TabsContent>
                <TabsContent value="incident" className="m-0 border-0 h-full">
                  <NotificationList
                    items={incidentNotifications}
                    onNavigate={onNavigate}
                    onMarkAsRead={markAsRead}
                    emptyMessage="No incident alerts"
                    emptySub="No recent incident notifications recorded"
                  />
                </TabsContent>
                <TabsContent value="schedule" className="m-0 border-0 h-full">
                  <NotificationList
                    items={scheduleNotifications}
                    onNavigate={onNavigate}
                    onMarkAsRead={markAsRead}
                    emptyMessage="No shift updates"
                    emptySub="No recent on-call rotations or schedule changes"
                  />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-2 shadow-xs">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 h-8 cursor-pointer"
            onClick={() => {
              setOpen(false);
              router.push('/settings/notifications/history');
            }}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            History Log
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 h-8 px-2.5 cursor-pointer"
            onClick={() => {
              setOpen(false);
              router.push('/settings/notifications');
            }}
            title="Notification Preferences"
          >
            <Settings2 className="h-3.5 w-3.5 mr-1 text-zinc-500 dark:text-zinc-400" />
            Preferences
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
