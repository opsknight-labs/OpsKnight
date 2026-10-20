import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import { readinessFixHint } from './rule-presentation';

type Check = BindingReadiness['checks'][number];

const GROUPS: Array<{
  state: Check['state'];
  title: string;
  icon: LucideIcon;
  iconClass: string;
  rowClass: string;
}> = [
  {
    state: 'blocked',
    title: 'Blocking',
    icon: XCircle,
    iconClass: 'text-rose-500',
    rowClass: 'border-rose-500/30 bg-rose-500/5',
  },
  {
    state: 'deferred',
    title: 'Warnings',
    icon: AlertTriangle,
    iconClass: 'text-amber-500',
    rowClass: 'border-amber-500/30 bg-amber-500/5',
  },
  {
    state: 'passed',
    title: 'Passed',
    icon: CheckCircle2,
    iconClass: 'text-emerald-500',
    rowClass: 'border-border bg-muted/20',
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
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-center">
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  return (
    <div className="space-y-4">
      {GROUPS.map(group => {
        const items = checks.filter(check => check.state === group.state);
        if (items.length === 0) return null;
        const Icon = group.icon;
        return (
          <div key={group.state} className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Icon className={cn('h-3.5 w-3.5', group.iconClass)} aria-hidden />
              <span>{group.title}</span>
              <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                {items.length}
              </span>
            </h3>
            <ul className="space-y-2">
              {items.map(check => {
                const hint =
                  check.state === 'passed'
                    ? null
                    : readinessFixHint(check.code, serviceId, runbookId);
                return (
                  <li
                    key={check.code}
                    className={cn(
                      'flex flex-col gap-2 rounded-xl border p-3 text-xs sm:text-sm sm:flex-row sm:items-center sm:justify-between shadow-2xs backdrop-blur-xs transition-all',
                      group.rowClass
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <Icon
                        className={cn('mt-0.5 h-4 w-4 shrink-0', group.iconClass)}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground break-words text-xs sm:text-sm">
                          {check.message}
                        </span>
                        <code className="mt-0.5 block text-[10px] font-mono text-muted-foreground/80">
                          {check.code}
                        </code>
                      </div>
                    </div>
                    {hint &&
                      (hint.href.startsWith('#') ? (
                        <a
                          href={hint.href}
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline bg-background/80 border border-primary/30 px-2.5 py-1 rounded-lg shadow-2xs transition-colors hover:bg-primary/5"
                        >
                          <span>Fix: {hint.label}</span>
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </a>
                      ) : (
                        <Link
                          href={hint.href}
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline bg-background/80 border border-primary/30 px-2.5 py-1 rounded-lg shadow-2xs transition-colors hover:bg-primary/5"
                        >
                          <span>Fix: {hint.label}</span>
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ))}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
