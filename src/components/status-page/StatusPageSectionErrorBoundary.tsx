'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Copy, Check } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

interface Props {
  sectionName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  correlationId: string;
  copied: boolean;
}

export default class StatusPageSectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      correlationId: '',
      copied: false,
    };
  }

  static getDerivedStateFromError(error: unknown): State {
    const err = error instanceof Error ? error : new Error(String(error) || 'Unknown error');
    const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
    const correlationId = `SP-${randomHex}`;
    return {
      hasError: true,
      error: err,
      correlationId,
      copied: false,
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`[StatusPageSection] Error in section ${this.props.sectionName}`, {
      section: this.props.sectionName,
      correlationId: this.state.correlationId,
      message: err.message,
      stack: err.stack,
      componentStack: errorInfo?.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, copied: false });
  };

  handleCopyCorrelationId = () => {
    if (this.state.correlationId) {
      navigator.clipboard?.writeText(this.state.correlationId);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-left space-y-3">
          <div className="flex items-center gap-2.5 text-destructive">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <h3 className="text-sm font-semibold">
              {this.props.sectionName} section couldn&apos;t load
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {getUserFacingErrorMessage(this.state.error)}
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry section
            </button>
            <button
              type="button"
              onClick={this.handleCopyCorrelationId}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs font-mono hover:bg-muted transition-colors"
              title="Copy Correlation ID for support"
            >
              {this.state.copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span>{this.state.correlationId}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
