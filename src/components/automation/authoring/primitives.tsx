'use client';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const selectClass =
  'peer flex h-8.5 w-full min-w-0 appearance-none cursor-pointer rounded-lg border border-border/70 bg-background/90 py-1 pl-2.5 pr-8 text-xs font-medium text-foreground shadow-2xs transition-all duration-150 hover:border-border hover:bg-background focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/30 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30';

export const textareaClass =
  'flex w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface NativeSelectProps extends ComponentProps<'select'> {
  wrapperClassName?: string;
  iconClassName?: string;
  icon?: LucideIcon;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  (
    { className, wrapperClassName, iconClassName, icon: Icon = ChevronDown, children, ...props },
    ref
  ) => {
    const hasExplicitWidth = className && /\b(w-|flex-|grow|shrink|col-span-)/.test(className);
    return (
      <div
        className={cn(
          'relative inline-flex items-center min-w-0',
          !hasExplicitWidth && !wrapperClassName?.includes('w-') && 'w-full',
          wrapperClassName
        )}
      >
        <select ref={ref} className={cn(selectClass, className)} {...props}>
          {children}
        </select>
        <Icon
          className={cn(
            'pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground transition-colors peer-focus:text-foreground peer-disabled:opacity-40',
            iconClassName
          )}
          aria-hidden="true"
        />
      </div>
    );
  }
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

export function InlineError({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-xs text-destructive', className)}>
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Hint({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('text-xs text-muted-foreground', className)}>
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
  compact = false,
}: {
  legend: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <fieldset
      className={cn(
        'min-w-0 rounded-lg border border-border/70',
        compact ? 'p-2.5 sm:p-3 bg-muted/10' : 'p-3 sm:p-4',
        className
      )}
    >
      <legend
        className={cn(
          'float-left flex w-full flex-wrap items-center justify-between gap-1.5 font-semibold tracking-tight',
          compact ? 'text-xs text-foreground' : 'text-sm'
        )}
      >
        <span className="min-w-0">{legend}</span>
        {aside}
      </legend>
      <div className={cn('clear-both pt-1', compact ? 'space-y-2' : 'space-y-3')}>
        {description && (
          <p
            className={cn(
              'text-muted-foreground',
              compact ? 'text-[11px] leading-snug' : 'text-xs'
            )}
          >
            {description}
          </p>
        )}
        {children}
      </div>
    </fieldset>
  );
}
