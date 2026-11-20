'use client';

import type { ReactNode } from 'react';
import PatternErrorState from '@/components/patterns/ErrorState';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  errorCode?: string;
  retryText?: string;
  onRetry?: () => void;
  onGoBack?: () => void;
  showDetails?: boolean;
  details?: string;
  icon?: ReactNode;
}

/**
 * Compatibility wrapper over `@/components/patterns/ErrorState`; keeps the original
 * props (details only render when `showDetails` is set).
 */
export default function ErrorState({
  retryText = 'Try Again',
  showDetails = false,
  details,
  ...props
}: ErrorStateProps) {
  return (
    <PatternErrorState
      {...props}
      retryText={retryText}
      backLabel="Go Back"
      details={showDetails ? details : undefined}
    />
  );
}
