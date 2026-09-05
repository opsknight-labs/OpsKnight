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
        <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-foreground mb-0.5">{emptyMessage}</p>
        <p className="text-xs text-muted-foreground">{emptySub}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60 relative">
      {items.map(notification => {
        const isIncident = notification.type === 'incident';
        const isService = notification.type === 'service';
        const isSchedule = notification.type === 'schedule';

        return (
          <div
            key={notification.id}
            className={cn(
              'group relative flex items-start gap-3 p-3.5 text-left transition-all duration-150 cursor-pointer hover:bg-muted/40',
              notification.unread
                ? 'bg-primary/[0.03] dark:bg-primary/[0.04] border-l-[3px] border-l-primary'
                : 'border-l-[3px] border-l-transparent opacity-85 hover:opacity-100'
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
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              )}
              {isService && (
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Server className="h-4 w-4" />
                </div>
              )}
              {isSchedule && (
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <CalendarClock className="h-4 w-4" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={cn(
                    'text-xs font-semibold leading-tight line-clamp-1',
                    notification.unread ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {notification.title}
                </p>
                {notification.unread && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-0.5 ring-2 ring-primary/20" />
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {notification.message}
              </p>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10.5px] text-muted-foreground/70 font-mono">
                  {notification.time}
                </span>
                {notification.incidentId && (
                  <span className="text-[10.5px] font-medium text-primary inline-flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
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
                className="opacity-0 group-hover:opacity-100 absolute top-2.5 right-2.5 p-1 rounded-md bg-background/90 hover:bg-background border border-border shadow-xs text-muted-foreground hover:text-foreground transition-all duration-150 cursor-pointer"
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
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 bg-background border-l border-border shadow-2xl">
        <SheetHeader className="px-5 pt-5 pb-3 pr-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <SheetTitle className="text-base font-bold tracking-tight">Notifications</SheetTitle>
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border',
                  isLive
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-zinc-500 bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    isLive ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'
                  )}
                />
                {isLive ? 'Live' : 'Polling'}
              </span>
            </div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={markAllRead}
              >
                <CheckCheck className="mr-1 h-3.5 w-3.5" />
                Mark all read
              </Button>
            )}
          </div>
          <SheetDescription className="sr-only">
            Recent activity, incident alerts, and schedule changes.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="all" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 pb-2.5 border-b border-border/80">
            <TabsList className="w-full grid grid-cols-4 h-8 p-0.5 bg-muted/60 dark:bg-zinc-900 rounded-lg">
              <TabsTrigger value="all" className="text-[11px] font-semibold py-1">
                All
              </TabsTrigger>
              <TabsTrigger value="unread" className="text-[11px] font-semibold py-1 gap-1">
                Unread
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="incident" className="text-[11px] font-semibold py-1">
                Incidents
              </TabsTrigger>
              <TabsTrigger value="schedule" className="text-[11px] font-semibold py-1">
                Shifts
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
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

        <div className="p-3 border-t border-border/80 bg-muted/20 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start text-xs text-muted-foreground hover:text-foreground h-8 cursor-pointer"
            onClick={() => {
              setOpen(false);
              router.push('/settings/notifications/history');
            }}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            History Log
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground h-8 px-2.5 cursor-pointer"
            onClick={() => {
              setOpen(false);
              router.push('/settings/notifications');
            }}
            title="Notification Preferences"
          >
            <Settings2 className="h-3.5 w-3.5 mr-1" />
            Preferences
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
