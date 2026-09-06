'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import ErrorState from './ErrorState';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary component to catch React errors and display fallback UI
 * 
 * @example
 * <ErrorBoundary fallback={<ErrorState title="Something went wrong" />}>
 *   <YourComponent />
 * </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: unknown): State {
    // Convert non-Error objects to Error instances
    if (error instanceof Error) {
      return {
        hasError: true,
        error,
      };
    }

    // Handle Event objects and other non-Error types
    const errorMessage = error && typeof error === 'object' && 'type' in error && 'target' in error
      ? 'An unexpected error occurred. Please try again.'
      : String(error) || 'An unexpected error occurred.';

    return {
      hasError: true,
      error: new Error(errorMessage),
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    // Convert non-Error objects to Error instances for logging
    const errorObj = error instanceof Error
      ? error
      : new Error(String(error) || 'Unknown error');

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      logger.error('ErrorBoundary caught an error', { component: 'ErrorBoundary', error: errorObj, errorInfo });
    }

    // Call optional error handler (only if it's an Error instance)
    if (this.props.onError && error instanceof Error) {
      this.props.onError(error, errorInfo);
    }

    // TODO: Send error to error tracking service (e.g., Sentry)
    // Example: Sentry.captureException(errorObj, { contexts: { react: errorInfo } });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const rawMessage = this.state.error?.message?.toLowerCase() || '';
      const isChunkError =
        rawMessage.includes('loading chunk') ||
        rawMessage.includes('chunkloaderror') ||
        rawMessage.includes('failed to fetch dynamically imported module') ||
        rawMessage.includes('error loading dynamically imported module');

      return (
        <ErrorState
          title={isChunkError ? 'Application Update Available' : 'Something went wrong'}
          message={
            isChunkError
              ? 'A new version of OpsKnight has been deployed. Please reload the page to get the latest updates.'
              : this.state.error
                ? getUserFacingErrorMessage(this.state.error)
                : 'An unexpected error occurred'
          }
          retryText={isChunkError ? 'Reload Application' : 'Try Again'}
          onRetry={() => {
            if (isChunkError && typeof window !== 'undefined') {
              window.location.reload();
            } else {
              this.setState({ hasError: false, error: null });
            }
          }}
        />
      );
    }

    return this.props.children;
  }
}






