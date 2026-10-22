import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import { readinessFixHint } from './rule-presentation';

type Check = BindingReadiness['checks'][number];

type GroupConfig = {
  state: Check['state'];
  label: string;
  sublabel: string;
  icon: LucideIcon;
  iconClass: string;
  badgeClass: string;
  indicatorClass: string;
};

const GROUPS: GroupConfig[] = [
  {
    state: 'blocked',
    label: 'Blocking Issues',
    sublabel: 'Must resolve before automated activation',
    icon: XCircle,
    iconClass: 'text-rose-500 dark:text-rose-400',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    indicatorClass: 'bg-rose-500',
  },
  {
    state: 'deferred',
    label: 'Warnings & Advisory',
    sublabel: 'Enforced at execution dispatch',
    icon: AlertTriangle,
    iconClass: 'text-amber-500 dark:text-amber-400',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    indicatorClass: 'bg-amber-500',
  },
  {
    state: 'passed',
    label: 'Passed Checks',
    sublabel: 'Verified valid configuration',
    icon: CheckCircle2,
    iconClass: 'text-emerald-500 dark:text-emerald-400',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    indicatorClass: 'bg-emerald-500',
  },
];

export function RuleReadiness({
  checks,
  serviceId,
  runbookId,
  emptyMessage = 'No readiness checks apply to this rule.',
}: {
  checks: BindingReadiness['checks'];
  serviceId: string;
  runbookId: string;
  emptyMessage?: string;
}) {
  if (checks.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-5 text-center">
        <p className="text-xs font-medium text-muted-foreground">{emptyMessage}</p>
      </div>
    );

  const activeGroups = GROUPS.map(group => ({
    ...group,
    items: checks.filter(check => check.state === group.state),
  })).filter(group => group.items.length > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 dark:border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
      {activeGroups.map((group, groupIdx) => {
        const Icon = group.icon;
        return (
          <div key={group.state} className={cn(groupIdx > 0 && 'border-t border-border/60')}>
            {/* Compact Group Section Header */}
            <div className="flex items-center justify-between bg-muted/30 px-3.5 py-1.5 border-b border-border/60">
              <div className="flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', group.indicatorClass)} />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  {group.label}
                </h4>
                <span
                  className={cn(
                    'rounded-full border px-1.5 py-0 text-[10px] font-mono font-bold leading-tight',
                    group.badgeClass
                  )}
                >
                  {group.items.length}
                </span>
              </div>
              <span className="hidden sm:inline text-[11px] text-muted-foreground font-normal">
                {group.sublabel}
              </span>
            </div>

            {/* Compact Check Rows */}
            <div className="divide-y divide-border/50">
              {group.items.map(check => {
                const hint =
                  check.state === 'passed'
                    ? null
                    : readinessFixHint(check.code, serviceId, runbookId);

                return (
                  <div
                    key={check.code}
                    className="flex flex-col gap-2 px-3.5 py-2 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/30 transition-colors"
                  >
                    {/* Left: Status Icon + Message + Code tag */}
                    <div className="flex min-w-0 items-start sm:items-center gap-2.5">
                      <Icon
                        className={cn('h-4 w-4 shrink-0 mt-0.5 sm:mt-0', group.iconClass)}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-medium text-foreground leading-snug">
                          {check.message}
                        </span>
                        <code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground shrink-0">
                          {check.code}
                        </code>
                      </div>
                    </div>

                    {/* Right: Compact Action Chip */}
                    {hint && (
                      <div className="shrink-0 pl-6.5 sm:pl-0">
                        {hint.href.startsWith('#') ? (
                          <a
                            href={hint.href}
                            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/90 hover:bg-muted/80 px-2 py-0.5 text-[11px] font-semibold text-foreground transition-colors shadow-2xs group"
                          >
                            <span>Fix: {hint.label}</span>
                            <ChevronRight
                              className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors"
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          <Link
                            href={hint.href}
                            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/90 hover:bg-muted/80 px-2 py-0.5 text-[11px] font-semibold text-foreground transition-colors shadow-2xs group"
                          >
                            <span>Fix: {hint.label}</span>
                            <ChevronRight
                              className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors"
                              aria-hidden="true"
                            />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
