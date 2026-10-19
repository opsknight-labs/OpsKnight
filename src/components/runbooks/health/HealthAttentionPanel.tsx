import Link from 'next/link';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, ShieldAlert, ZapOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Pill, TONE_SURFACE } from '../ui/primitives';

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
  if (!agentsCount && !issues.length)
    return (
      <section
        aria-label="Automation health status"
        className="flex flex-col gap-4 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground border border-border/60 shadow-2xs">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h3 className="!text-base !leading-snug font-semibold tracking-tight">
              No Agents configured
            </h3>
            <p className="text-sm text-muted-foreground">
              Fleet health is unknown until an Agent reports a heartbeat.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0 self-start sm:self-center shadow-xs">
          <Link href="/runbooks/agents">
            Enroll an Agent
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );

  const critical = issues.filter(issue => issue.severity === 'danger').length;
  const hasIssues = issues.length > 0;
  const tone = hasIssues
    ? critical > 0
      ? 'danger'
      : 'warning'
    : health === 'HEALTHY'
      ? 'success'
      : 'neutral';
  const HeroIcon = hasIssues ? AlertTriangle : health === 'HEALTHY' ? CheckCircle2 : ShieldAlert;
  const heroTitle = hasIssues
    ? `${issues.length} ${issues.length === 1 ? 'issue needs' : 'issues need'} attention`
    : health === 'HEALTHY'
      ? 'All systems healthy'
      : 'Automation health requires verification';
  const heroDescription = hasIssues
    ? critical > 0
      ? `${critical} critical ${critical === 1 ? 'item' : 'items'} first. Each item links to where it can be fixed.`
      : 'No critical items. Review the warnings below before they affect dispatch.'
    : health === 'UNKNOWN'
      ? 'Worker health is not verified. Agent heartbeats and an empty queue do not establish dispatch readiness.'
      : 'No alerts were observed in available worker, queue and Agent evidence. Target permissions still require workflow-specific checks.';

  return (
    <section aria-label="Automation health status" className="space-y-3">
      <div
        className={cn(
          'flex items-start gap-4 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-6 shadow-xs',
          tone === 'danger' && 'border-rose-500/40 bg-rose-500/[0.04]',
          tone === 'warning' && 'border-amber-500/40 bg-amber-500/[0.04]',
          tone === 'success' && 'border-emerald-500/40 bg-emerald-500/[0.04]'
        )}
      >
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-2xs',
            tone === 'danger'
              ? TONE_SURFACE.danger
              : tone === 'warning'
                ? TONE_SURFACE.warning
                : tone === 'success'
                  ? TONE_SURFACE.success
                  : TONE_SURFACE.neutral
          )}
        >
          <HeroIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="!text-base !leading-snug font-bold tracking-tight text-foreground">
            {heroTitle}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{heroDescription}</p>
        </div>
      </div>

      {hasIssues && (
        <ul
          aria-label="Issues needing attention"
          className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs"
        >
          {issues.map(issue => {
            const Icon =
              issue.type === 'agent' ? Bot : issue.type === 'circuit' ? ZapOff : ShieldAlert;
            const danger = issue.severity === 'danger';
            return (
              <li
                key={issue.id}
                className="flex flex-col gap-3 p-4.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      'flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
                      danger ? TONE_SURFACE.danger : TONE_SURFACE.warning
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{issue.title}</h4>
                      <Pill tone={danger ? 'danger' : 'warning'}>
                        {danger ? 'Critical' : 'Warning'}
                      </Pill>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {issue.description}
                    </p>
                  </div>
                </div>

                {issue.actionHref && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 gap-1 self-start text-xs sm:self-center shadow-2xs"
                  >
                    <Link href={issue.actionHref}>
                      <span>{issue.actionLabel || 'Investigate'}</span>
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
