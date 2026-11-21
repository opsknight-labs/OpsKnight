'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import InsightBadge from '@/components/intelligence/insights/InsightBadge';
import type { OpsInsightCount } from '@/lib/intelligence/ops-insights/contract';
import { RelativeTime } from '@/components/patterns';
import {
  ShieldAlert,
  Clock,
  MoreVertical,
  ArrowRight,
  Server,
  Layers,
  User,
  Users,
  Calendar,
} from 'lucide-react';

export type PolicyDirectoryItem = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  stepCount: number;
  serviceCount: number;
  services: { id: string; name: string }[];
  /** Open escalation insights on this policy, for the list badge. */
  insights?: OpsInsightCount | null;
  steps: {
    id: string;
    stepOrder: number;
    delayMinutes: number;
    targetType: string;
    targetUser?: { id: string; name: string } | null;
    targetTeam?: { id: string; name: string } | null;
    targetSchedule?: { id: string; name: string } | null;
  }[];
};

type PolicyStep = PolicyDirectoryItem['steps'][number];

export function stepTargetName(step: PolicyStep, idx: number) {
  return (
    step.targetUser?.name || step.targetTeam?.name || step.targetSchedule?.name || `Step ${idx + 1}`
  );
}

export function policyTotalMinutes(policy: PolicyDirectoryItem) {
  return policy.steps.reduce((acc, s) => acc + s.delayMinutes, 0);
}

/** Full step chain for tooltips: "Primary On-Call → Miles Patel +10m → … (total ~30m)". */
export function policyStepChain(policy: PolicyDirectoryItem) {
  if (policy.stepCount === 0) return 'No steps defined';
  const chain = policy.steps
    .map((s, i) => `${stepTargetName(s, i)}${s.delayMinutes > 0 ? ` +${s.delayMinutes}m` : ''}`)
    .join(' → ');
  return `${chain} (total duration ~${policyTotalMinutes(policy)}m)`;
}

export function StepTargetIcon({ targetType }: { targetType: string }) {
  if (targetType === 'USER') return <User className="h-2.5 w-2.5 shrink-0 text-blue-500" />;
  if (targetType === 'TEAM') return <Users className="h-2.5 w-2.5 shrink-0 text-emerald-500" />;
  if (targetType === 'SCHEDULE')
    return <Calendar className="h-2.5 w-2.5 shrink-0 text-amber-500" />;
  return null;
}

export function PolicyActionsMenu({ policy }: { policy: PolicyDirectoryItem }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Actions for {policy.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/policies/${policy.id}`} className="flex cursor-pointer items-center gap-2">
            <Layers />
            View & Configure Policy
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function PolicyDirectoryCard({ policy }: { policy: PolicyDirectoryItem }) {
  const visibleServices = policy.services.slice(0, 3);
  const remainingServicesCount = policy.services.length - visibleServices.length;

  return (
    <Card className="group flex flex-col justify-between border-border bg-card transition-colors hover:border-primary/40">
      <CardContent className="space-y-2.5 p-3.5">
        {/* Header: Title, Description & Action Menu */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/policies/${policy.id}`}
                className="block truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary"
              >
                {policy.name}
              </Link>
              <InsightBadge count={policy.insights} />
            </div>
            {policy.description ? (
              <p className="line-clamp-1 text-xs text-muted-foreground" title={policy.description}>
                {policy.description}
              </p>
            ) : (
              <p className="text-xs italic text-muted-foreground/60">No description provided</p>
            )}
          </div>
          <PolicyActionsMenu policy={policy} />
        </div>

        {/* Step Flow Breakdown */}
        <div className="space-y-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>
                {policy.stepCount} Escalation Step{policy.stepCount !== 1 ? 's' : ''}
              </span>
            </span>
            <span className="text-[10px]">
              {policy.stepCount === 0
                ? 'No steps defined'
                : `Total duration ~${policyTotalMinutes(policy)}m`}
            </span>
          </div>

          {policy.stepCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {policy.steps.slice(0, 4).map((step, idx) => (
                <div key={step.id || idx} className="flex items-center gap-1">
                  <div className="flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                    <StepTargetIcon targetType={step.targetType} />
                    <span>{stepTargetName(step, idx)}</span>
                    {step.delayMinutes > 0 && (
                      <span className="font-mono text-[9px] text-muted-foreground">
                        +{step.delayMinutes}m
                      </span>
                    )}
                  </div>
                  {idx < Math.min(policy.steps.length - 1, 3) && (
                    <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
                  )}
                </div>
              ))}
              {policy.stepCount > 4 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  +{policy.stepCount - 4} more
                </span>
              )}
            </div>
          ) : (
            <p className="rounded border border-amber-100/60 bg-amber-50/50 px-2 py-1 text-[11px] text-amber-700/80 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              Needs setup: add at least one notification step
            </p>
          )}
        </div>

        {/* Linked Services Section */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Server className="h-3 w-3" />
            <span>Assigned Services ({policy.serviceCount})</span>
          </div>

          {policy.serviceCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {visibleServices.map(service => (
                <Link key={service.id} href={`/services/${service.id}`} className="inline-flex">
                  <Badge
                    variant="secondary"
                    className="cursor-pointer border border-border px-1.5 py-0 text-[10px] transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    {service.name}
                  </Badge>
                </Link>
              ))}
              {remainingServicesCount > 0 && (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                >
                  +{remainingServicesCount} more
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
              <ShieldAlert className="h-3 w-3" />
              <span>Unassigned (no services routing here)</span>
            </div>
          )}
        </div>

        {/* Card Footer: Detail Link */}
        <div className="flex items-center justify-between border-t border-border pt-2 text-[11px]">
          <span className="text-muted-foreground">
            {policy.serviceCount > 0 ? 'Active routing' : 'Standby'} · Updated{' '}
            <RelativeTime date={policy.updatedAt} />
          </span>
          <Link
            href={`/policies/${policy.id}`}
            className="flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Configure Rules
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
