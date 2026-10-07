import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ShieldAlert,
  ZapOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
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
};

export function HealthAttentionPanel({
  issues,
  agentsCount,
}: HealthAttentionPanelProps) {
  if (!agentsCount && !issues.length) return <div className="rounded-lg border bg-muted/30 p-4 text-sm"><h3 className="font-semibold">No Agents configured</h3><p className="text-muted-foreground">Fleet health is unknown until an Agent reports a heartbeat.</p><Link className="text-primary hover:underline" href="/runbooks/agents">Enroll an Agent</Link></div>;
  const hasIssues = issues.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
          <span>Operational Health & Attention</span>
          {hasIssues ? (
            <Badge variant="danger" className="text-xs px-2 py-0">
              {issues.length} {issues.length === 1 ? 'Action Required' : 'Actions Required'}
            </Badge>
          ) : (
            <Badge variant="success" className="text-xs px-2 py-0">
              All Systems Operational
            </Badge>
          )}
        </h3>
      </div>

      {!hasIssues ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <h4 className="font-semibold text-sm text-foreground">
                No critical automation issues
              </h4>
              <p className="text-muted-foreground leading-relaxed">
                All {agentsCount} enrolled Agents have active heartbeats, queue dispatch is nominal,
                and no circuit breakers or expired leases require operator intervention.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {issues.map(issue => (
            <div
              key={issue.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 text-xs transition-colors ${
                issue.severity === 'danger'
                  ? 'border-rose-500/30 bg-rose-500/5'
                  : 'border-amber-500/30 bg-amber-500/5'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`rounded-full p-2 shrink-0 ${
                    issue.severity === 'danger'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {issue.type === 'agent' ? (
                    <Bot className="h-4 w-4" />
                  ) : issue.type === 'circuit' ? (
                    <ZapOff className="h-4 w-4" />
                  ) : (
                    <ShieldAlert className="h-4 w-4" />
                  )}
                </div>
                <div className="space-y-0.5">
                  <h4 className="font-semibold text-foreground text-sm">{issue.title}</h4>
                  <p className="text-muted-foreground">{issue.description}</p>
                </div>
              </div>

              {issue.actionHref && (
                <Button asChild size="sm" variant="outline" className="h-8 text-xs shrink-0 self-start sm:self-center gap-1">
                  <Link href={issue.actionHref}>
                    <span>{issue.actionLabel || 'Investigate'}</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
