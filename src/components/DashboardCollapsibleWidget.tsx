'use client';

import { useState, ReactNode, useEffect, useCallback, memo, useId } from 'react';

type DashboardCollapsibleWidgetProps = {
  title: string;
  icon?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
};

/**
 * DashboardCollapsibleWidget
 * A collapsible container for dashboard widgets with smooth animation
 * Handles hydration properly to prevent layout shift
 */
const DashboardCollapsibleWidget = memo(function DashboardCollapsibleWidget({
  title,
  icon,
  defaultExpanded = true,
  children,
}: DashboardCollapsibleWidgetProps) {
  // Use a stable ID for accessibility
  const contentId = useId();

  // Initialize with defaultExpanded to prevent hydration mismatch
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpanded();
      }
    },
    [toggleExpanded]
  );

  // For SSR, always show content if defaultExpanded is true to prevent layout shift
  // After hydration, use actual state
  const shouldShowContent = isMounted ? isExpanded : defaultExpanded;

  return (
    <div className="glass-panel" style={{ background: 'white', padding: '0', overflow: 'hidden' }}>
      <button
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        type="button"
        aria-expanded={shouldShowContent}
        aria-controls={contentId}
        style={{
          width: '100%',
          padding: '1rem 1.5rem',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          transition: 'background 0.2s ease',
        }}
        className="dashboard-collapsible-header"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {icon && <span aria-hidden="true">{icon}</span>}
          <h3
            style={{
              fontSize: '1.1rem',
              fontWeight: '700',
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            {title}
          </h3>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: shouldShowContent ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={contentId}
        role="region"
        aria-labelledby={`${contentId}-header`}
        style={{
          overflow: 'hidden',
          transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
          maxHeight: shouldShowContent ? '2000px' : '0',
          opacity: shouldShowContent ? 1 : 0,
        }}
      >
        <div style={{ padding: '0 1.5rem 1.5rem 1.5rem' }}>{children}</div>
      </div>
    </div>
  );
});

export default DashboardCollapsibleWidget;
