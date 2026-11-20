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

export default Skeleton;
