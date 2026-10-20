import Link from 'next/link';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, ShieldAlert, ZapOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';

export type HealthIssue = {
  id: string;
  type: 'agent' | 'circuit' | 'lease' | 'unknown' | 'queue';
  title: string;
  description: string;
  severity: 'warning' | 'danger';
  actionHref?: string;
  actionLabel?: string;
};

export type HealthAttentionPanelProps = {
  issues: HealthIssue[];
  agentsCount: number;
  health?: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
};

export function HealthAttentionPanel({
  issues: unsortedIssues,
  agentsCount,
  health = 'UNKNOWN',
}: HealthAttentionPanelProps) {
  const issues = [...unsortedIssues].sort(
    (a, b) => Number(b.severity === 'danger') - Number(a.severity === 'danger')
  );

  // No agents configured empty state
  if (!agentsCount && !issues.length) {
    return (
      <section
        aria-label="Automation health status"
        className="flex flex-col gap-4 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground border border-border/60 shadow-2xs">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              No Agents configured
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Fleet health is unknown until an Agent reports a heartbeat. Connect an outbound Agent
              to enable host-level execution.
            </p>
          </div>
        </div>
        <Button
          asChild
          size="sm"
          className="shrink-0 self-start sm:self-center shadow-xs h-8 text-xs font-semibold"
        >
          <Link href="/runbooks/agents">
            Enroll an Agent
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );
  }

  const critical = issues.filter(issue => issue.severity === 'danger').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  const hasIssues = issues.length > 0;

  // Fully healthy state
  if (!hasIssues) {
    const isHealthy = health === 'HEALTHY';
    return (
      <section
        aria-label="Automation health status"
        className={cn(
          'flex items-center gap-3.5 rounded-2xl border p-4.5 shadow-xs backdrop-blur-xs',
          isHealthy
            ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
            : 'border-border/80 bg-card/90 dark:bg-card/50'
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
            isHealthy
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {isHealthy ? (
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-bold tracking-tight text-foreground">
            {isHealthy ? 'All Systems Operational' : 'Automation Health Requires Verification'}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isHealthy
              ? 'Execution workers, background queues, and connected agents are reporting healthy status.'
              : 'Worker health is not verified. Agent heartbeats and an empty queue do not establish dispatch readiness.'}
          </p>
        </div>
      </section>
    );
  }

  // Active issues present - Grid of discrete modern alert cards
  return (
    <section aria-label="Automation health status" className="space-y-3.5">
      {/* Section Header */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between px-1">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
              critical > 0
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
            )}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold tracking-tight text-foreground">
              System Attention Required
            </h2>
            <div className="flex items-center gap-1.5">
              {critical > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                  {critical} {critical === 1 ? 'Critical' : 'Critical'}
                </span>
              )}
              {warnings > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {warnings} {warnings === 1 ? 'Warning' : 'Warnings'}
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground hidden sm:block">
          {critical > 0
            ? 'Immediate remediation recommended to unblock execution dispatch.'
            : 'Review warnings before they impact live runbook automation.'}
        </p>
      </div>

      {/* Grid of Alert Cards with explicit p-5 padding */}
      <div
        className={cn(
          'grid gap-4 grid-cols-1',
          issues.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'
        )}
      >
        {issues.map(issue => {
          const Icon =
            issue.type === 'agent' ? Bot : issue.type === 'circuit' ? ZapOff : ShieldAlert;
          const isDanger = issue.severity === 'danger';

          return (
            <div
              key={issue.id}
              className={cn(
                'group relative flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all hover:shadow-sm backdrop-blur-xs',
                isDanger
                  ? 'border-rose-500/35 bg-card/90 dark:bg-card/50 hover:border-rose-500/60'
                  : 'border-amber-500/35 bg-card/90 dark:bg-card/50 hover:border-amber-500/60'
              )}
            >
              <div>
                {/* Card Top: Icon Badge + Severity Tag */}
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
                      isDanger
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase ring-1 ring-inset',
                      isDanger
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30'
                    )}
                  >
                    {isDanger && (
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                    )}
                    {isDanger ? 'Critical' : 'Warning'}
                  </span>
                </div>

                {/* Card Title & Description */}
                <div className="mt-4 space-y-1.5">
                  <h3 className="text-sm font-bold tracking-tight text-foreground">
                    {issue.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {issue.description}
                  </p>
                </div>
              </div>

              {/* Card Footer: Action Button */}
              {issue.actionHref && (
                <div className="mt-5 pt-3.5 border-t border-border/50">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className={cn(
                      'w-full justify-between h-8 px-3 text-xs font-semibold rounded-xl border-border/80 bg-background/80 hover:bg-accent shadow-2xs group-hover:border-foreground/30 transition-all',
                      isDanger
                        ? 'hover:border-rose-500/50 hover:text-rose-600 dark:hover:text-rose-400'
                        : 'hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400'
                    )}
                  >
                    <Link href={issue.actionHref}>
                      <span>{issue.actionLabel || 'Investigate'}</span>
                      <ArrowRight
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
                        aria-hidden="true"
                      />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
