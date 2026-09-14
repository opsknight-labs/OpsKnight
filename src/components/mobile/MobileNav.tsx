'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MOBILE_NAV_ITEMS, MOBILE_MORE_ROUTES } from '@/components/mobile/mobileNavItems';
import { isFocusedMobileWorkflow } from '@/lib/mobile-chrome';
import { haptics } from '@/lib/haptics';
import { useNotificationStream } from '@/hooks/useNotificationStream';

export default function MobileNav() {
  const pathname = usePathname() || '/m';
  const [unreadCount, setUnreadCount] = useState(0);
  const [pollingRequired, setPollingRequired] = useState(false);
  const moreIndex = MOBILE_NAV_ITEMS.findIndex(item => item.href === '/m/more');
  const focusedWorkflow = isFocusedMobileWorkflow(pathname);

  useEffect(() => {
    const appElement = document.querySelector<HTMLElement>('.mobile-app');
    if (appElement) appElement.dataset.bottomNav = focusedWorkflow ? 'absent' : 'present';
    const scrollContainer = document.querySelector<HTMLElement>('.mobile-content');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, [pathname, focusedWorkflow]);

  const fetchCount = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const response = await fetch('/api/notifications?limit=1', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as {
        notifications?: Array<{ unread?: boolean }>;
        unreadCount?: number;
      };
      const fallback = (data.notifications ?? []).filter(item => item.unread).length;
      setUnreadCount(Math.max(0, data.unreadCount ?? fallback));
    } catch {
      // Badge freshness must never make primary navigation unavailable.
    }
  }, []);

  useNotificationStream({
    onUnreadCount: count => setUnreadCount(count),
    onError: error => {
      // The shared stream reconnects itself after transient failures. Poll only
      // on platforms that genuinely have no EventSource implementation.
      if (/not supported/i.test(error.message)) setPollingRequired(true);
    },
  });

  useEffect(() => {
    setPollingRequired(typeof EventSource === 'undefined');
    void fetchCount();
  }, [fetchCount]);

  useEffect(() => {
    if (!pollingRequired) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval || document.hidden) return;
      interval = setInterval(() => void fetchCount(), 30_000);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const visibility = () => {
      if (document.hidden) stop();
      else {
        void fetchCount();
        start();
      }
    };
    const online = () => void fetchCount();
    start();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', online);
    };
  }, [fetchCount, pollingRequired]);

  const directIndex = MOBILE_NAV_ITEMS.findIndex(item => {
    if (item.href === '/m') return pathname === '/m';
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  });
  const activeIndex =
    directIndex >= 0
      ? directIndex
      : moreIndex >= 0 &&
          MOBILE_MORE_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))
        ? moreIndex
        : -1;

  if (focusedWorkflow) return null;

  const handleTabClick = (active: boolean) => {
    haptics.selection();
    if (!active) return;
    const scrollContainer = document.querySelector<HTMLElement>('.mobile-content');
    if (scrollContainer && scrollContainer.scrollTop > 5) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <nav className="mobile-nav" data-swipe-ignore="true" aria-label="Primary mobile navigation">
      {MOBILE_NAV_ITEMS.map((item, index) => {
        const active = index === activeIndex;
        const hasBadge = 'hasBadge' in item && item.hasBadge && unreadCount > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item ${active ? 'active' : ''}`}
            onClick={() => handleTabClick(active)}
            aria-label={`${item.label}${hasBadge ? `, ${unreadCount} unread notifications` : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobile-nav-icon">
              {active ? item.iconActive : item.icon}
              {hasBadge ? (
                <span className="mobile-nav-badge" aria-hidden="true">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </span>
            <span className="mobile-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
