'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

type InlineNoticeTone = 'success' | 'error' | 'warning' | 'info' | 'neutral';
type InlineNoticeUrgency = 'polite' | 'assertive';

interface InlineNoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: InlineNoticeTone;
  urgency?: InlineNoticeUrgency;
  title?: string;
  icon?: React.ReactNode;
  onDismiss?: () => void;
}

function getToneStyles(tone: InlineNoticeTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200';
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200';
    case 'info':
      return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-200';
    case 'neutral':
      return 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-100';
  }
}

function getDefaultIcon(tone: InlineNoticeTone): React.ReactNode {
  switch (tone) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />;
    case 'info':
      return <Info className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />;
    case 'neutral':
      return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />;
  }
}

/**
 * InlineNotice — semantic, theme-safe alternative to hand-built emerald/rose Alerts.
 *
 * Contract:
 * - success/info/neutral => role="status" aria-live="polite" (no focus steal)
 * - error with assertive urgency => role="alert" (immediate)
 * - Visual styling is centrally owned so dark mode cannot produce a light-green flash.
 * - No sonner dependency; this is for persistent/field-level/contextual notices, not toasts.
 */
export function InlineNotice({
  tone = 'info',
  urgency,
  title,
  icon,
  onDismiss,
  className,
  children,
  role: roleProp,
  'aria-live': ariaLiveProp,
  ...props
}: InlineNoticeProps) {
  const isError = tone === 'error';
  const resolvedUrgency: InlineNoticeUrgency = urgency ?? (isError ? 'assertive' : 'polite');
  // Caller overrides are explicit; default derives from tone/urgency so tests and a11y
  // have a stable contract: error+assertive => alert/assertive, others => status/polite.
  const role = roleProp ?? (resolvedUrgency === 'assertive' ? 'alert' : 'status');
  const ariaLive = ariaLiveProp ?? (resolvedUrgency === 'assertive' ? 'assertive' : 'polite');
  const toneClass = getToneStyles(tone);
  const toneIcon = getDefaultIcon(tone);

  return (
    <div
      {...props}
      role={role}
      aria-live={ariaLive}
      className={cn(
        'flex gap-2.5 rounded-lg border p-3.5 text-sm leading-relaxed',
        toneClass,
        className
      )}
    >
      {icon !== null && (icon ?? toneIcon)}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold leading-none">{title}</p>}
        {children && <div className={cn(!title && 'font-medium')}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-current opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors motion-reduce:transition-none h-7 w-7 flex items-center justify-center"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
