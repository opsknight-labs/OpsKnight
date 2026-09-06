'use client';

import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'card';
}

/**
 * Skeleton loading component for mobile UI
 * Displays shimmer animation while content is loading
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius = '8px',
  className = '',
  variant = 'rectangular',
}: SkeletonProps) {
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'text':
        return { borderRadius: '4px', height: '1em' };
      case 'circular':
        return { borderRadius: '50%' };
      case 'card':
        return { borderRadius: '12px', height: '120px' };
      default:
        return { borderRadius };
    }
  };

  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width,
        height,
        background:
          'linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-surface) 50%, var(--bg-secondary) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        ...getVariantStyles(),
      }}
    />
  );
}

/**
 * Skeleton card for incident list
 */
export function IncidentCardSkeleton() {
  return (
    <div
      style={{
        padding: '1rem',
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="60px" height="20px" borderRadius="4px" />
        <Skeleton width="40px" height="18px" borderRadius="999px" />
      </div>
      <Skeleton width="85%" height="1.1rem" borderRadius="4px" />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Skeleton width="80px" height="14px" borderRadius="4px" />
        <Skeleton width="60px" height="14px" borderRadius="4px" />
      </div>
    </div>
  );
}

/**
 * Skeleton for metric cards on dashboard
 */
export function MetricCardSkeleton() {
  return (
    <div
      style={{
        padding: '1rem',
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
      }}
    >
      <Skeleton width="2rem" height="2rem" borderRadius="6px" />
      <Skeleton width="60%" height="1.5rem" borderRadius="4px" variant="text" />
      <Skeleton width="40%" height="0.75rem" borderRadius="4px" variant="text" />
    </div>
  );
}

/**
 * Skeleton for team/user list items
 */
export function ListItemSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.875rem',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <Skeleton width="40px" height="40px" variant="circular" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <Skeleton width="120px" height="14px" borderRadius="4px" />
        <Skeleton width="80px" height="12px" borderRadius="4px" />
      </div>
    </div>
  );
}

/**
 * Skeleton screen for full page loading
 */
export function PageSkeleton({ itemCount = 3 }: { itemCount?: number }) {
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header skeleton */}
      <Skeleton width="50%" height="1.5rem" borderRadius="6px" />

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>

      {/* List header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
        <Skeleton width="100px" height="1rem" borderRadius="4px" />
        <Skeleton width="60px" height="1rem" borderRadius="4px" />
      </div>

      {/* List items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {Array.from({ length: itemCount }).map((_, i) => (
          <IncidentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default Skeleton;
