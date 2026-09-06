'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, type CSSProperties, useCallback } from 'react';
import { MOBILE_NAV_ITEMS, MOBILE_MORE_ROUTES } from '@/components/mobile/mobileNavItems';
import { haptics } from '@/lib/haptics';
import { useNotificationStream } from '@/hooks/useNotificationStream';

export default function MobileNav() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const moreIndex = MOBILE_NAV_ITEMS.findIndex(item => item.href === '/m/more');

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=1');
      if (res.ok) {
        const data = await res.json();
        const unread = (data.notifications || []).filter(
          (n: { unread: boolean }) => n.unread
        ).length;
        setUnreadCount(data.unreadCount || unread);
      }
    } catch {
      // Silent fail
    }
  }, []);

  const [usePolling, setUsePolling] = useState(false);

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
      if (document.hidden) {
        stopPolling();
      } else if (usePolling) {
        startPolling();
      }
    };

    initialTimer = setTimeout(() => {
      void fetchCount();
    }, 0);

    if (usePolling) {
      startPolling();
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      stopPolling();
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchCount, usePolling]);

  const resolveActiveIndex = () => {
    const directIndex = MOBILE_NAV_ITEMS.findIndex(item => {
      if (item.href === '/m') return pathname === '/m';
      return pathname === item.href || pathname.startsWith(`${item.href}/`);
    });
    if (directIndex >= 0) return directIndex;
    if (
      moreIndex >= 0 &&
      MOBILE_MORE_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))
    ) {
      return moreIndex;
    }
    return -1;
  };

  // Calculate active index for slider position
  const activeIndex = resolveActiveIndex();
  const sliderIndex = activeIndex === -1 ? 0 : activeIndex;

  return (
    <nav
      className="mobile-nav"
      aria-label="Mobile navigation"
      style={
        {
          display: 'grid',
          gridTemplateColumns: `repeat(${MOBILE_NAV_ITEMS.length}, 1fr)`,
          '--mobile-nav-count': MOBILE_NAV_ITEMS.length,
        } as CSSProperties
      }
    >
      {/* Animated active indicator */}
      <div
        className="mobile-nav-slider"
        aria-hidden="true"
        style={{
          width: '100%',
          transform: `translateX(${sliderIndex * 100}%)`,
        }}
      />
      {MOBILE_NAV_ITEMS.map((item, index) => {
        const active = index === activeIndex;
        // Determine aria-label: use item label or fallback + notification count
        const label = item.label;
        const badgeText =
          'hasBadge' in item && item.hasBadge && unreadCount > 0
            ? `, ${unreadCount} unread notifications`
            : '';

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item ${active ? 'active' : ''}`}
            style={{ maxWidth: 'unset' }}
            onClick={() => haptics.selection()}
            aria-label={`${label}${badgeText}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobile-nav-icon" style={{ position: 'relative' }}>
              {active ? item.iconActive : item.icon}
              {/* Notification badge */}
              {'hasBadge' in item && item.hasBadge && unreadCount > 0 && (
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
