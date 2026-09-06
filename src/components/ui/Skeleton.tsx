'use client';

import { CSSProperties } from 'react';

type SkeletonVariant = 'text' | 'circular' | 'rectangular' | 'rounded';
type SkeletonAnimation = 'pulse' | 'wave' | 'none';

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  animation?: SkeletonAnimation;
  className?: string;
  style?: CSSProperties;
}

/**
 * Skeleton component for loading states
 * 
 * @example
 * <Skeleton variant="text" width="100%" />
 * <Skeleton variant="circular" width={40} height={40} />
 * <Skeleton variant="rectangular" width="100%" height={200} />
 */
export default function Skeleton({
  variant = 'rectangular',
  width,
  height,
  animation = 'pulse',
  className = '',
  style,
}: SkeletonProps) {
  const baseStyle: CSSProperties = {
    backgroundColor: 'var(--color-neutral-200)',
    borderRadius: variant === 'circular' ? 'var(--radius-full)' : variant === 'rounded' ? 'var(--radius-md)' : 'var(--radius-sm)',
    width: width || (variant === 'text' ? '100%' : undefined),
    height: height || (variant === 'text' ? '1em' : variant === 'circular' ? width : undefined),
    display: 'inline-block',
    ...style,
  };

  const animationClass = animation === 'pulse' ? 'skeleton-pulse' : animation === 'wave' ? 'skeleton-wave' : '';

  return (
    <span
      className={`skeleton skeleton-${variant} ${animationClass} ${className}`}
      style={baseStyle}
      aria-label="Loading..."
      role="status"
    />
  );
}

/**
 * SkeletonText component for text loading states
 */
function SkeletonText({
  lines = 3,
  width = '100%',
  className = '',
}: {
  lines?: number;
  width?: number | string;
  className?: string;
}) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          variant="text"
          width={index === lines - 1 ? '80%' : width}
          animation="pulse"
        />
      ))}
    </div>
  );
}
export { SkeletonText };

/**
 * SkeletonCard component for card loading states
 */
export function SkeletonCard({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        padding: 'var(--spacing-6)',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
      }}
    >
      <Skeleton variant="rectangular" width="60%" height={24} style={{ marginBottom: 'var(--spacing-4)' }} />
      <SkeletonText lines={3} width="100%" />
      <div style={{ marginTop: 'var(--spacing-4)', display: 'flex', gap: 'var(--spacing-2)' }}>
        <Skeleton variant="rectangular" width={80} height={32} />
        <Skeleton variant="rectangular" width={80} height={32} />
      </div>
    </div>
  );
}






