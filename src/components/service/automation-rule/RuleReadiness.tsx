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
  if (checks.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <div className="space-y-5">
      {GROUPS.map(group => {
        const items = checks.filter(check => check.state === group.state);
        if (items.length === 0) return null;
        const Icon = group.icon;
        return (
          <div key={group.state} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Icon className={cn('h-4 w-4', group.iconClass)} aria-hidden />
              {group.title}
              <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
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
                      'flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-start sm:justify-between',
                      group.rowClass
                    )}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <Icon
                        className={cn('mt-0.5 h-4 w-4 shrink-0', group.iconClass)}
                        aria-hidden
                      />
                      <span className="min-w-0 break-words">{check.message}</span>
                    </span>
                    {hint &&
                      (hint.href.startsWith('#') ? (
                        <a
                          href={hint.href}
                          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                        >
                          Fix: {hint.label}
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </a>
                      ) : (
                        <Link
                          href={hint.href}
                          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                        >
                          Fix: {hint.label}
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
