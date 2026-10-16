import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RuleSection({
  id,
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn('scroll-mt-20 rounded-xl border bg-card shadow-xs', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

/** One numbered step in an ordered checklist; render inside an `<ol>`. */
export function RuleActionTile({
  id,
  step,
  icon: Icon,
  title,
  description,
  children,
  tone,
  last,
}: {
  id?: string;
  step: number;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
  tone?: 'warning';
  last?: boolean;
}) {
  return (
    <li id={id} className="relative flex min-w-0 scroll-mt-20 gap-4">
      {!last && <span aria-hidden className="absolute bottom-0 left-[15px] top-9 w-px bg-border" />}
      <span
        aria-hidden
        className={cn(
          'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold tabular-nums ring-1 ring-inset',
          tone === 'warning'
            ? 'text-amber-700 ring-amber-500/40 dark:text-amber-300'
            : 'text-primary ring-primary/30'
        )}
      >
        {step}
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 space-y-3 rounded-lg border p-4',
          last ? '' : 'mb-3',
          tone === 'warning' ? 'border-amber-500/40 bg-amber-500/5' : 'bg-muted/20'
        )}
      >
        <div className="space-y-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground'
              )}
              aria-hidden
            />
            {title}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </li>
  );
}

export const RULE_SECTIONS = [
  { id: 'checks', label: 'Run & validate' },
  { id: 'overview', label: 'Readiness' },
  { id: 'trigger', label: 'Trigger' },
  { id: 'target', label: 'Target' },
  { id: 'version', label: 'Version' },
  { id: 'history', label: 'History' },
  { id: 'policy', label: 'Policy' },
  { id: 'audit', label: 'Audit' },
] as const;

export function RuleSectionNav() {
  return (
    <nav
      aria-label="Rule evidence sections"
      className="sticky top-0 z-20 -mx-1 overflow-x-auto rounded-xl border bg-background/95 p-1 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <ul className="flex min-w-max gap-1">
        {RULE_SECTIONS.map(section => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
