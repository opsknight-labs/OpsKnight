'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
import { Bell, CheckCheck, Inbox, Archive } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';

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

export default function TopbarNotifications() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useModalState('notifications');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
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

    eventSource.onmessage = event => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'notifications' && data.notifications) {
          // Add new notifications to the list
          setNotifications(prev => {
            const existingIds = new Set(prev.map(n => n.id));
            const newNotifications = data.notifications.filter(
              (n: Notification) => !existingIds.has(n.id)
            );
            return [...newNotifications, ...prev].slice(0, 50); // Keep latest 50
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
      // Fallback to polling if SSE fails
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

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllAsRead: true }),
      });
      setNotifications(prev =>
        prev.map(notification =>
          notification.unread ? { ...notification, unread: false } : notification
        )
      );
      setUnreadCount(0);
    } catch (error) {
      logger.error('Error marking all as read', { component: 'TopbarNotifications', error });
    }
  };

  // Note: Removed automatic mark-as-read on open to allow users to triage via Unread tab first.
  // Or we can keep it but maybe only for "All" tab?
  // User often prefers manual clearing or click-to-read.
  // I'll leave manual 'Mark all as read' button as primary action.

  const NotificationList = ({ items }: { items: Notification[] }) => {
    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Inbox className="h-12 w-12 opacity-20 mb-4" />
          <p>No notifications</p>
          <p className="text-sm">You are all caught up!</p>
        </div>
      );
    }
    return (
      <div className="divide-y relative">
        {items.map(notification => (
          <button
            key={notification.id}
            className={`w-full flex items-start gap-4 p-4 text-left hover:bg-muted/50 transition-colors ${notification.unread ? 'bg-muted/30' : ''}`}
            onClick={() => {
              if (notification.incidentId) {
                const isMobileContext = pathname?.startsWith('/m');
                const targetUrl = isMobileContext
                  ? `/m/incidents/${notification.incidentId}`
                  : `/incidents/${notification.incidentId}`;

                setOpen(false);
                router.push(targetUrl);
              }
            }}
          >
            <div className="mt-1 shrink-0">
              {notification.type === 'incident' && (
                <div className="rounded-full bg-red-100 p-2 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M12 3 2.5 20h19L12 3Zm0 6 4.5 9h-9L12 9Zm0 3v4"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              )}
              {notification.type === 'service' && (
                <div className="rounded-full bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 6h16v5H4V6Zm0 7h16v5H4v-5Z" />
                  </svg>
                </div>
              )}
              {notification.type === 'schedule' && (
                <div className="rounded-full bg-purple-100 p-2 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M7 3v3m10-3v3M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`text-sm font-medium leading-none ${notification.unread ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {notification.title}
                </p>
                {notification.unread && (
                  <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0 mt-1" />
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{notification.message}</p>
              <p className="text-xs text-muted-foreground/70">{notification.time}</p>
            </div>
          </button>
        ))}
      </div>
    );
  };

  const unreadNotifications = notifications.filter(n => n.unread);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="danger"
              size="xs"
              className="absolute -top-1 -right-1 h-4 w-4 rounded-full p-0"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-sm flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between mb-2">
            <SheetTitle>Notifications</SheetTitle>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-8 px-2" onClick={markAllRead}>
                <CheckCheck className="mr-1 h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>
        </SheetHeader>

        <Tabs defaultValue="all" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pb-2 border-b">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">
                Unread
                {unreadCount > 0 && (
                  <Badge variant="secondary" size="xs" className="ml-2 h-5 min-w-[1.25rem]">
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                Loading notifications...
              </div>
            ) : (
              <>
                <TabsContent value="all" className="m-0 border-0 h-full">
                  <NotificationList items={notifications} />
                </TabsContent>
                <TabsContent value="unread" className="m-0 border-0 h-full">
                  <NotificationList items={unreadNotifications} />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>

        <div className="p-4 border-t bg-muted/20">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={() => {
              setOpen(false);
              window.location.href = '/settings/notifications/history';
            }}
          >
            <Archive className="mr-2 h-4 w-4" />
            View Archive
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
