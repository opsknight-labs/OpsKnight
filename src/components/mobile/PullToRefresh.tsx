'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { haptics } from '@/lib/haptics';
import { isInteractiveMobileTarget } from '@/lib/mobile-interactive';
import { useMobileRefreshEpoch } from '@/components/mobile/MobileRefreshContext';

const REFRESH_TIMEOUT_MS = 15_000;

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const refreshEpoch = useMobileRefreshEpoch();
  const [pullChange, setPullChange] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const refreshStartEpochRef = useRef<string | null>(null);
  const completionRef = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pullThreshold = 70;
  const maxPull = 100;

  useEffect(() => {
    if (!refreshing || !refreshStartEpochRef.current) return;
    if (refreshEpoch === refreshStartEpochRef.current) return;
    completionRef.current?.();
  }, [refreshEpoch, refreshing]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      completionRef.current = null;
    };
  }, []);

  const waitForServerRender = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          completionRef.current = null;
          resolve();
        };
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          completionRef.current = null;
          reject(new Error('Fresh data did not finish loading. Check your connection and retry.'));
        }, REFRESH_TIMEOUT_MS);
        completionRef.current = finish;
      }),
    []
  );

  const initLoading = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    refreshStartEpochRef.current = refreshEpoch;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchTimeout = window.setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

    try {
      const response = await fetch('/api/mobile/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathname,
          search: searchParams.toString(),
        }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new Error('Your session expired. Sign in again to refresh.');
      }
      if (!response.ok) {
        throw new Error('Fresh data could not be loaded. Please retry.');
      }

      const renderCompletion = waitForServerRender();
      router.refresh();
      await renderCompletion;
      haptics.success();
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Refresh timed out. Check your connection and retry.'
          : error instanceof Error
            ? error.message
            : 'Refresh failed. Please retry.';
      setRefreshError(message);
      haptics.error();
    } finally {
      window.clearTimeout(fetchTimeout);
      if (abortRef.current === controller) abortRef.current = null;
      completionRef.current = null;
      refreshStartEpochRef.current = null;
      setRefreshing(false);
      setPullChange(0);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isInteractiveMobileTarget(e.target)) {
      startXRef.current = null;
      startYRef.current = null;
      return;
    }

    const scrollParent = containerRef.current?.closest('.mobile-content');
    const scrollTop = scrollParent
      ? scrollParent.scrollTop
      : window.scrollY || document.documentElement.scrollTop;

    if (scrollTop <= 0 && !refreshing && e.targetTouches?.[0]) {
      startXRef.current = e.targetTouches[0].clientX ?? 0;
      startYRef.current = e.targetTouches[0].clientY ?? 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isInteractiveMobileTarget(e.target)) {
      if (pullChange !== 0) setPullChange(0);
      startXRef.current = null;
      startYRef.current = null;
      return;
    }

    const scrollParent = containerRef.current?.closest('.mobile-content');
    const scrollTop = scrollParent
      ? scrollParent.scrollTop
      : window.scrollY || document.documentElement.scrollTop;

    if (scrollTop > 0 || refreshing) return;
    if (startYRef.current === null || startXRef.current === null) return;
    if (!e.targetTouches?.[0]) return;

    const touchX = e.targetTouches[0].clientX ?? 0;
    const touchY = e.targetTouches[0].clientY ?? 0;
    const diffX = Math.abs(touchX - startXRef.current);
    const diffY = touchY - startYRef.current;

    if (diffY > 0 && diffY > diffX * 1.5) {
      setPullChange(Math.min(diffY * 0.45, maxPull));
    } else if (diffX > diffY && pullChange !== 0) {
      setPullChange(0);
    }
  };

  const handleTouchEnd = () => {
    if (startYRef.current === null) return;

    if (pullChange > pullThreshold) void initLoading();
    else setPullChange(0);

    startXRef.current = null;
    startYRef.current = null;
  };

  const progress = Math.min(pullChange / pullThreshold, 1);
  const isReady = pullChange >= pullThreshold;
  const accent = 'hsl(var(--ui-primary))';
  const muted = 'hsl(var(--ui-muted-foreground))';

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ minHeight: '100%', position: 'relative' }}
    >
      <div
        aria-live="polite"
        style={{
          height: pullChange > 0 || refreshing ? '70px' : '0',
          overflow: 'hidden',
          transition: refreshing ? 'height 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          position: 'relative',
          zIndex: 10,
          background: 'transparent',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            opacity: Math.max(progress, refreshing ? 1 : 0),
            transform: `scale(${0.8 + progress * 0.2})`,
            transition: refreshing ? 'opacity 0.2s ease' : 'none',
          }}
        >
          <div style={{ position: 'relative', width: '40px', height: '40px' }}>
            <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: 'absolute', top: 0, left: 0 }} aria-hidden="true">
              <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--ui-border))" strokeWidth="3" />
            </svg>
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: 'rotate(-90deg)',
                animation: refreshing ? 'spin 1s linear infinite' : 'none',
              }}
            >
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke={isReady || refreshing ? accent : muted}
                strokeWidth="3"
                strokeDasharray={`${progress * 100} 100`}
                strokeLinecap="round"
                style={{ transition: 'stroke 0.2s ease' }}
              />
            </svg>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) rotate(${refreshing ? 0 : isReady ? 180 : pullChange * 1.5}deg)`,
                transition: refreshing ? 'none' : 'transform 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {refreshing ? (
                <span style={{ fontSize: '16px', color: accent }}>•</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isReady ? accent : muted} strokeWidth="2.5">
                  <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: isReady || refreshing ? accent : muted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'color 0.2s ease',
            }}
          >
            {refreshing ? 'Refreshing fresh data…' : isReady ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      </div>

      {refreshError ? (
        <div
          role="alert"
          className="mx-3 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {refreshError}
        </div>
      ) : null}

      <div>{children}</div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
      `}</style>
    </div>
  );
}
