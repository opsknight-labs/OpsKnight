import type { ComponentType, InputHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-rose-600 dark:text-rose-400',
  info: 'text-sky-600 dark:text-sky-400',
  brand: 'text-primary',
};

export const TONE_SURFACE: Record<Tone, string> = {
  neutral: 'bg-muted/60 text-muted-foreground ring-border',
  success: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  danger: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300',
  info: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
  brand: 'bg-primary/10 text-primary ring-primary/20',
};

/** Primary content container used across all runbook surfaces. */
export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  children,
  id,
  className,
  bodyClassName,
  tone,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: IconType;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  tone?: Extract<Tone, 'danger' | 'warning'>;
}) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-24 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs hover:border-border transition-colors overflow-hidden',
        tone === 'danger' && 'border-destructive/40 bg-destructive/[0.02]',
        tone === 'warning' && 'border-amber-500/40 bg-amber-500/[0.02]',
        className
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
                  TONE_SURFACE[tone ?? 'brand']
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="!text-sm !font-bold !tracking-tight !leading-snug text-foreground">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Compact KPI tile; renders as a link when href is set. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconType;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg border shadow-2xs shrink-0',
              // eslint-disable-next-line security/detect-object-injection -- tone is a typed enum of known tokens
              TONE_SURFACE[tone]
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-xs text-muted-foreground/80">{hint}</div>}
    </>
  );
  const classes = cn(
    'block rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-4 sm:p-5 shadow-xs transition-all duration-200',
    href &&
      'hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** Small rounded label for states, modes and counts. */
export function Pill({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: IconType;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border shadow-2xs',
        // eslint-disable-next-line security/detect-object-injection -- tone is a typed enum of known tokens
        TONE_SURFACE[tone],
        className
      )}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/** Definition list in a responsive two-column grid. */
export function KeyValueGrid({
  items,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; wide?: boolean }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {items.map((item, index) => (
        <div key={index} className={cn('min-w-0', item.wide && 'sm:col-span-2')}>
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Search input with a leading icon that never overlaps the text. */
export function SearchField({
  className,
  inputClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { inputClassName?: string }) {
  return (
    <label
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 shadow-xs focus-within:ring-2 focus-within:ring-ring',
        className
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        type="search"
        {...props}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          inputClassName
        )}
      />
    </label>
  );
}

/** Segmented control for 2–5 mutually exclusive options (client components only). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex rounded-lg border bg-muted/50 p-0.5', className)}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap shrink-0',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="rounded bg-muted px-1 text-[10px] tabular-nums">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Inline empty state for sections and tables (page-level empty states use EmptyState). */
export function EmptyHint({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconType;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center',
        className
      )}
    >
      {Icon && (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
