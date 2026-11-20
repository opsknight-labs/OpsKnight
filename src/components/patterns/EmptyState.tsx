import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EmptyStateProps = {
  icon?: ReactNode;
  /** One line: what is empty ("No incidents match these filters"). */
  title: string;
  /** One sentence on what this area is for and how to fill it. */
  description?: ReactNode;
  /** The next action (button or link). Alias: `primaryAction`. */
  action?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  /** Docs/help link shown under the actions. */
  helpLink?: { href: string; label: string };
  variant?: 'dashed' | 'card' | 'simple';
  size?: 'sm' | 'md' | 'lg';
  /** Heading element for the title; match the surrounding outline. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
};

/** Teaching empty state: icon, title, one sentence and the next action. Never just "No data". */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  primaryAction,
  secondaryAction,
  helpLink,
  variant = 'dashed',
  size = 'md',
  headingLevel: Heading = 'h3',
  className,
}: EmptyStateProps) {
  const primary = primaryAction ?? action;
  const isExternal = helpLink ? /^https?:\/\//.test(helpLink.href) : false;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        variant === 'dashed' && 'rounded-lg border border-dashed border-border bg-muted/20',
        variant === 'card' && 'rounded-lg border border-border bg-card shadow-2xs',
        variant === 'simple' && 'p-4',
        size === 'sm' && 'gap-2 p-6',
        size === 'md' && 'gap-3 p-8 sm:p-10',
        size === 'lg' && 'gap-4 p-12 sm:p-16',
        className
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-2xl bg-muted text-muted-foreground',
            size === 'sm' && 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5',
            size === 'md' && 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6',
            size === 'lg' && 'h-16 w-16 [&>svg]:h-8 [&>svg]:w-8'
          )}
        >
          {icon}
        </div>
      )}

      <div className="max-w-md space-y-1">
        <Heading
          className={cn(
            'font-semibold tracking-tight text-foreground',
            size === 'sm' && 'text-sm',
            size === 'md' && 'text-base',
            size === 'lg' && 'text-lg'
          )}
        >
          {title}
        </Heading>
        {description && (
          <div
            className={cn(
              'leading-relaxed text-muted-foreground',
              size === 'sm' ? 'text-xs' : 'text-sm'
            )}
          >
            {description}
          </div>
        )}
      </div>

      {(primary || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          {primary}
          {secondaryAction}
        </div>
      )}

      {helpLink && (
        <Link
          href={helpLink.href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {helpLink.label}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
