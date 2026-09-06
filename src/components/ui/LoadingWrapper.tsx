'use client';

import { ReactNode } from 'react';
import _Skeleton, { SkeletonText } from './Skeleton';
import Spinner from './Spinner';

interface LoadingWrapperProps {
  isLoading: boolean;
  children: ReactNode;
  fallback?: ReactNode;
  variant?: 'skeleton' | 'spinner' | 'custom';
  skeletonLines?: number;
  className?: string;
}

/**
 * LoadingWrapper component for conditional loading states
 * 
 * @example
 * <LoadingWrapper isLoading={isLoading} variant="skeleton" skeletonLines={3}>
 *   <DataComponent data={data} />
 * </LoadingWrapper>
 */
export default function LoadingWrapper({
  isLoading,
  children,
  fallback,
  variant = 'spinner',
  skeletonLines = 3,
  className = '',
}: LoadingWrapperProps) {
  if (isLoading) {
    if (fallback) {
      return <>{fallback}</>;
    }

    if (variant === 'skeleton') {
      return (
        <div className={className}>
          <SkeletonText lines={skeletonLines} />
        </div>
      );
    }

    if (variant === 'spinner') {
      return (
        <div 
          className={className}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '2rem',
          }}
        >
          <Spinner size="md" variant="primary" />
        </div>
      );
    }

    return null;
  }

  return <>{children}</>;
}
