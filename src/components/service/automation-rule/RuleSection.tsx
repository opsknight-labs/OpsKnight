import type { ReactNode } from 'react';
import {
  Activity,
  GitBranch,
  History,
  PlayCircle,
  Radio,
  ScrollText,
  Server,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
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
      className={cn(
        'scroll-mt-20 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs hover:border-border transition-colors',
        className
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-bold tracking-tight text-foreground">
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
    <li id={id} className={cn('relative flex min-w-0 scroll-mt-20 gap-4', !last && 'pb-4')}>
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-[17px] top-9 -bottom-0 w-0.5 bg-border/70 dark:bg-border/50"
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-4 ring-background shadow-xs z-10 transition-colors',
          tone === 'warning'
            ? 'bg-amber-500/10 text-amber-700 border border-amber-500/30 dark:text-amber-300'
            : 'bg-card text-primary border border-primary/30'
        )}
      >
        {step}
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 space-y-3.5 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-4 sm:p-5 shadow-xs hover:border-border transition-colors',
          tone === 'warning' && 'border-amber-500/40 bg-amber-500/[0.04]'
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg shrink-0 border shadow-2xs',
              tone === 'warning'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                : 'bg-muted/80 text-muted-foreground border-border/60'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm font-bold tracking-tight text-foreground">{title}</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="min-w-0 pt-0.5">{children}</div>
      </div>
    </li>
  );
}

export const RULE_SECTIONS = [
  { id: 'checks', label: 'Run & validate', icon: PlayCircle },
  { id: 'overview', label: 'Readiness', icon: Activity },
  { id: 'trigger', label: 'Trigger', icon: Radio },
  { id: 'target', label: 'Target', icon: Server },
  { id: 'version', label: 'Version & inputs', icon: GitBranch },
  { id: 'history', label: 'History', icon: History },
  { id: 'policy', label: 'Policy evidence', icon: ShieldCheck },
  { id: 'audit', label: 'Audit trail', icon: ScrollText },
] as const;

export function RuleSectionNav() {
  return (
    <nav
      aria-label="Rule evidence sections"
      className="sticky top-0 z-20 -mx-1 overflow-x-auto rounded-2xl border border-border/80 dark:border-border/60 bg-background/95 p-1.5 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <ul className="flex min-w-max gap-1">
        {RULE_SECTIONS.map(section => {
          const Icon = section.icon;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground hover:shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="h-3.5 w-3.5 opacity-70" />
                <span>{section.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
