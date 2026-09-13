'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MOBILE_NAV_ITEMS, MOBILE_MORE_ROUTES } from '@/components/mobile/mobileNavItems';
import { haptics } from '@/lib/haptics';
import { useNotificationStream } from '@/hooks/useNotificationStream';

export default function MobileNav() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [usePolling, setUsePolling] = useState(false);
  const moreIndex = MOBILE_NAV_ITEMS.findIndex(item => item.href === '/m/more');

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=1');
      if (!res.ok) return;
      const data = await res.json();
      const unread = (data.notifications || []).filter((item: { unread: boolean }) => item.unread).length;
      setUnreadCount(data.unreadCount || unread);
    } catch {
      // Navigation must remain usable if alert count refresh fails.
    }
  }, []);

  useNotificationStream({
    enabled: !usePolling,
    onUnreadCount: count => setUnreadCount(count),
    onError: () => setUsePolling(true),
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(fetchCount, 30000);
    };
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const handleVisibility = () => {
      if (document.hidden) stopPolling();
      else if (usePolling) startPolling();
    };

    initialTimer = setTimeout(() => void fetchCount(), 0);
    if (usePolling) {
      startPolling();
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      stopPolling();
      if (initialTimer) clearTimeout(initialTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchCount, usePolling]);

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

  return (
    <nav className="mobile-nav" aria-label="Primary mobile navigation">
      {MOBILE_NAV_ITEMS.map((item, index) => {
        const active = index === activeIndex;
        const hasBadge = 'hasBadge' in item && item.hasBadge && unreadCount > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item ${active ? 'active' : ''}`}
            onClick={() => haptics.selection()}
            aria-label={`${item.label}${hasBadge ? `, ${unreadCount} unread notifications` : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobile-nav-icon">
              {active ? item.iconActive : item.icon}
              {hasBadge && (
                <span className="mobile-nav-badge" aria-hidden="true">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
            <span className="mobile-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
