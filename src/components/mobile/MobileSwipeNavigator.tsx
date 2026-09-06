'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MOBILE_NAV_ITEMS, MOBILE_MORE_ROUTES } from '@/components/mobile/mobileNavItems';
import { cn } from '@/lib/utils';

type MobileSwipeNavigatorProps = {
  children: ReactNode;
};

const SWIPE_MIN_DISTANCE = 80;
const VERTICAL_TOLERANCE = 1.2;
const SWIPE_NAV_DELAY_MS = 120;
const SWIPE_HINT_MS = 2200;
const SWIPE_HINT_KEY = 'mobileSwipeHintSeen';
const INTERACTIVE_SELECTOR =
  'a,button,input,textarea,select,[data-swipe-ignore],[role="button"],[role="slider"],[role="tab"]';

const isInteractiveTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest(INTERACTIVE_SELECTOR));
};

const resolveActiveIndex = (pathname: string) => {
  const directIndex = MOBILE_NAV_ITEMS.findIndex(item => {
    if (item.href === '/m') return pathname === '/m';
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  });
  if (directIndex >= 0) return directIndex;
  const moreIndex = MOBILE_NAV_ITEMS.findIndex(item => item.href === '/m/more');
  if (
    moreIndex >= 0 &&
    MOBILE_MORE_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))
  ) {
    return moreIndex;
  }
  return -1;
};

export default function MobileSwipeNavigator({ children }: MobileSwipeNavigatorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeIndex = useMemo(() => resolveActiveIndex(pathname), [pathname]);

  const [snapDirection, setSnapDirection] = useState<'left' | 'right' | null>(null);
  const [showHint, setShowHint] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (!('ontouchstart' in window)) return false;
    try {
      if (window.localStorage.getItem(SWIPE_HINT_KEY)) return false;
      window.localStorage.setItem(SWIPE_HINT_KEY, 'true');
      return true;
    } catch {
      return false;
    }
  });
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const cancelled = useRef(false);
  const navTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (navTimeout.current) {
        clearTimeout(navTimeout.current);
      }
      if (hintTimeout.current) {
        clearTimeout(hintTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showHint) return;
    hintTimeout.current = setTimeout(() => setShowHint(false), SWIPE_HINT_MS);
    return () => {
      if (hintTimeout.current) {
        clearTimeout(hintTimeout.current);
      }
    };
  }, [showHint]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    if (isInteractiveTarget(event.target)) return;
    tracking.current = true;
    cancelled.current = false;
    startX.current = event.clientX;
    startY.current = event.clientY;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!tracking.current || cancelled.current) return;
    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;
    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_TOLERANCE) {
      cancelled.current = true;
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!tracking.current) return;
    tracking.current = false;
    if (cancelled.current || activeIndex === -1) return;

    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
    if (Math.abs(dx) < Math.abs(dy) * VERTICAL_TOLERANCE) return;

    if (dx < 0 && activeIndex < MOBILE_NAV_ITEMS.length - 1) {
      setSnapDirection('left');
      if (navigator?.vibrate) {
        navigator.vibrate(12);
      }
      if (navTimeout.current) {
        clearTimeout(navTimeout.current);
      }
      navTimeout.current = setTimeout(() => {
        router.push(MOBILE_NAV_ITEMS[activeIndex + 1].href);
        setSnapDirection(null);
        navTimeout.current = null;
      }, SWIPE_NAV_DELAY_MS);
    } else if (dx > 0 && activeIndex > 0) {
      setSnapDirection('right');
      if (navigator?.vibrate) {
        navigator.vibrate(12);
      }
      if (navTimeout.current) {
        clearTimeout(navTimeout.current);
      }
      navTimeout.current = setTimeout(() => {
        router.push(MOBILE_NAV_ITEMS[activeIndex - 1].href);
        setSnapDirection(null);
        navTimeout.current = null;
      }, SWIPE_NAV_DELAY_MS);
    }
  };

  const handlePointerCancel = () => {
    tracking.current = false;
    cancelled.current = true;
    setSnapDirection(null);
  };

  return (
    <div
      className="relative"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {[
        <div
          key={pathname}
          className={cn(
            'mobile-route-transition transition-transform duration-150',
            snapDirection === 'left' && '-translate-x-2',
            snapDirection === 'right' && 'translate-x-2'
          )}
        >
          {children}
        </div>,
      ]}
      {showHint && (
        <div
          className="mobile-swipe-hint pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-4 py-2 text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-sm backdrop-blur opacity-90"
          aria-hidden="true"
        >
          <span className="text-[color:var(--text-muted)]">←</span>
          <span>Swipe to switch tabs</span>
          <span className="text-[color:var(--text-muted)]">→</span>
        </div>
      )}
    </div>
  );
}
