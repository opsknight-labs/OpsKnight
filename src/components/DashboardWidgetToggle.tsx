'use client';

import { useState, useEffect, useCallback, memo } from 'react';

type WidgetToggleProps = {
  widgetId: string;
  defaultVisible?: boolean;
  children: React.ReactNode;
  title: string;
};

/**
 * Storage key prefix for widget visibility
 */
const STORAGE_KEY_PREFIX = 'widget-visibility-';

/**
 * Safely reads from localStorage
 */
function getStoredVisibility(widgetId: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue;

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${widgetId}`);
    if (stored === null) return defaultValue;
    return stored === 'true';
  } catch {
    return defaultValue;
  }
}

/**
 * Safely writes to localStorage
 */
function setStoredVisibility(widgetId: string, visible: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${widgetId}`, String(visible));
  } catch {
    // Silently fail if storage is unavailable
  }
}

/**
 * DashboardWidgetToggle
 * Allows users to hide/show dashboard widgets with persistence
 */
const DashboardWidgetToggle = memo(function DashboardWidgetToggle({
  widgetId,
  defaultVisible = true,
  children,
  title,
}: WidgetToggleProps) {
  const [isVisible, setIsVisible] = useState(defaultVisible);
  const [isMounted, setIsMounted] = useState(false);

  // Load visibility state from localStorage after mount
  useEffect(() => {
    setIsMounted(true);
    const stored = getStoredVisibility(widgetId, defaultVisible);
    setIsVisible(stored);
  }, [widgetId, defaultVisible]);

  const toggleVisibility = useCallback(() => {
    setIsVisible(prev => {
      const newVisible = !prev;
      setStoredVisibility(widgetId, newVisible);
      return newVisible;
    });
  }, [widgetId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleVisibility();
      }
    },
    [toggleVisibility]
  );

  // During SSR, render based on defaultVisible
  const shouldShow = isMounted ? isVisible : defaultVisible;

  if (!shouldShow) {
    return (
      <div
        className="glass-panel"
        style={{ background: 'white', padding: '1rem', opacity: 0.6 }}
        role="region"
        aria-label={`${title} widget (hidden)`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3
            style={{
              fontSize: '1rem',
              fontWeight: '600',
              margin: 0,
              color: 'var(--text-muted)',
            }}
          >
            {title} (Hidden)
          </h3>
          <button
            onClick={toggleVisibility}
            onKeyDown={handleKeyDown}
            style={{
              padding: '0.4rem 0.8rem',
              background: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: '600',
              transition: 'background 0.2s ease',
            }}
            aria-label={`Show ${title} widget`}
          >
            Show
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }} role="region" aria-label={`${title} widget`}>
      <button
        onClick={toggleVisibility}
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          zIndex: 10,
          background: 'rgba(0, 0, 0, 0.1)',
          border: 'none',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.9rem',
          color: 'var(--text-secondary)',
          transition: 'all 0.2s ease',
        }}
        aria-label={`Hide ${title} widget`}
        title={`Hide ${title} widget`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {children}
    </div>
  );
});

export default DashboardWidgetToggle;
