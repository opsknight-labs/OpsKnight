'use client';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export const selectClass =
  'flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

export const textareaClass =
  'flex w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const NativeSelect = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(selectClass, className)} {...props} />
  )
);
NativeSelect.displayName = 'NativeSelect';

export function LimitCounter({
  count,
  limit,
  noun,
  className,
}: {
  count: number;
  limit: number;
  noun: string;
  className?: string;
}) {
  const full = count >= limit;
  return (
    <span
      className={cn(
        'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums',
        full
          ? 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-border/70 text-muted-foreground',
        className
      )}
    >
      {count} / {limit} {noun}
      {full && <span className="sr-only"> (limit reached)</span>}
    </span>
  );
}

export function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Hint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Fieldset whose legend sits in a header row alongside optional metadata such as a limit counter. */
export function AuthoringFieldset({
  legend,
  description,
  aside,
  children,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('min-w-0 rounded-lg border border-border/70 p-3 sm:p-4', className)}>
      <legend className="float-left flex w-full flex-wrap items-center justify-between gap-2 text-sm font-semibold tracking-tight">
        <span className="min-w-0">{legend}</span>
        {aside}
      </legend>
      <div className="clear-both space-y-3 pt-1">
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {children}
      </div>
    </fieldset>
  );
}
