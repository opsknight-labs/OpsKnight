'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Section-level actions, right-aligned in the header (one primary at most). */
  action?: React.ReactNode;
  /** Save bar or summary; sits on a muted band under the content. */
  footer?: React.ReactNode;
  /** Anchor id, e.g. for deep links from the settings search. */
  id?: string;
  /** Match the page outline: `h2` under the page `h1`, `h3` inside a tab panel with its own `h2`. */
  headingLevel?: 'h2' | 'h3';
  /** `danger` frames irreversible actions (delete, revoke all, reset). */
  tone?: 'default' | 'danger';
  contentClassName?: string;
}

/** The settings section card: title, one-line description, actions, content and footer. */
export function SettingsSection({
  title,
  description,
  children,
  className,
  action,
  footer,
  id,
  headingLevel: Heading = 'h2',
  tone = 'default',
  contentClassName,
}: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        tone === 'danger' && 'border-rose-200 dark:border-rose-500/30',
        className
      )}
    >
      <div className="flex flex-col justify-between gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:gap-4 md:px-6">
        <div className="min-w-0 space-y-1">
          <Heading
            id={headingId}
            className={cn(
              'text-base font-semibold leading-6 tracking-tight text-foreground',
              tone === 'danger' && 'text-rose-700 dark:text-rose-300'
            )}
          >
            {title}
          </Heading>
          {description && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>

      <div className={cn('px-4 md:px-6', contentClassName)}>{children}</div>

      {footer && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 md:px-6">{footer}</div>
      )}
    </section>
  );
}
