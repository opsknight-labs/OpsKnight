'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { haptics } from '@/lib/haptics';

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pullChange, setPullChange] = useState<number>(0);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pullThreshold = 70;
  const maxPull = 100;

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    const closest = target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"], [data-disable-pull]'
    );
    return closest instanceof Element;
  };

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const initLoading = async () => {
    setRefreshing(true);
    haptics.success();
    // Trigger Next.js router refresh
    router.refresh();

    // Keep indicator visible for smooth UX
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
      setPullChange(0);
      refreshTimeoutRef.current = null;
    }, 1200);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isInteractiveTarget(e.target)) {
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
    if (isInteractiveTarget(e.target)) {
      if (pullChange !== 0) {
        setPullChange(0);
      }
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
      // Rubber band resistance effect
      const pull = Math.min(diffY * 0.45, maxPull);
      setPullChange(pull);
    } else if (diffX > diffY && pullChange !== 0) {
      setPullChange(0);
    }
  };

  const handleTouchEnd = () => {
    if (startYRef.current === null) return;

    if (pullChange > pullThreshold) {
      initLoading();
    } else {
      setPullChange(0);
    }
    startXRef.current = null;
    startYRef.current = null;
  };

  // Calculate progress for visual feedback
  const progress = Math.min(pullChange / pullThreshold, 1);
  const isReady = pullChange >= pullThreshold;

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        minHeight: '100vh',
        position: 'relative',
      }}
    >
      {/* Pull-to-Refresh Indicator */}
      <div
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
          {/* Circular Progress / Spinner Container */}
          <div
            style={{
              position: 'relative',
              width: '40px',
              height: '40px',
            }}
          >
            {/* Background ring */}
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth="3" />
            </svg>

            {/* Progress ring */}
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
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
                stroke={isReady || refreshing ? 'var(--primary-color)' : 'var(--text-muted)'}
                strokeWidth="3"
                strokeDasharray={`${progress * 100} 100`}
                strokeLinecap="round"
                style={{
                  transition: 'stroke 0.2s ease',
                }}
              />
            </svg>

            {/* Center icon */}
            <div
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
                <span style={{ fontSize: '16px' }}>⚡</span>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isReady ? 'var(--primary-color)' : 'var(--text-muted)'}
                  strokeWidth="2.5"
                  style={{ transition: 'stroke 0.2s ease' }}
                >
                  <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>

          {/* Status text */}
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: isReady || refreshing ? 'var(--primary-color)' : 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'color 0.2s ease',
            }}
          >
            {refreshing ? 'Refreshing...' : isReady ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      </div>

      <div style={{ transition: 'none' }}>{children}</div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(-90deg);
          }
          to {
            transform: rotate(270deg);
          }
        }
      `}</style>
    </div>
  );
}
