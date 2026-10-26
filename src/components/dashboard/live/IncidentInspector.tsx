'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  ShieldAlert,
  UserPlus,
  Workflow,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PriorityBadge from '@/components/incident/PriorityBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  formatIncidentAge,
  type LiveIncident,
} from '@/lib/dashboard/live-incidents-shared';
import { SlaChip } from './LiveIncidentRow';

export function IncidentInspector({
  incident,
  now,
  currentUserId,
  currentUserName: _currentUserName,
  canAcknowledge,
  canAssignSelf,
  busy,
  onAcknowledge,
  onAssignSelf,
  onClose,
}: {
  incident: LiveIncident;
  now: number;
  currentUserId: string;
  currentUserName?: string;
  canAcknowledge: boolean;
  canAssignSelf: boolean;
  busy: 'ack' | 'assign' | null;
  onAcknowledge: (incident: LiveIncident) => void;
  onAssignSelf: (incident: LiveIncident) => void;
  onClose: () => void;
}) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isAssignedToMe = incident.assignee?.id === currentUserId;
  const isTriggered = incident.status === 'OPEN';
  const showAck = canAcknowledge && isTriggered;
  const showAssign = canAssignSelf && !isAssignedToMe;

  // Authoritative escalation status derived from real incident telemetry
  const escalationState =
    incident.escalationLevel !== null
      ? `Step ${incident.escalationLevel}${incident.escalationPolicyName ? ` · ${incident.escalationPolicyName}` : ''}`
      : !isTriggered
        ? 'Halted (incident acknowledged)'
        : incident.escalationPolicyName
          ? `Policy assigned · ${incident.escalationPolicyName}`
          : null;

  // Authoritative next action recommendation derived from real state
  let nextActionText = '';
  if (isTriggered) {
    if (!incident.assignee) {
      nextActionText =
        'Unassigned and triggered. Assign a responder and acknowledge to halt secondary escalation timeouts.';
    } else {
      nextActionText =
        'Assigned to responder. Acknowledge the incident to confirm ownership and halt secondary escalation timeouts.';
    }
  } else {
    if (incident.sla?.warning === 'BREACHED') {
      nextActionText =
        'SLA deadline breached. Mitigate service disruption and update incident timeline.';
    } else if (incident.sla?.warning === 'APPROACHING') {
      nextActionText =
        'SLA deadline approaching. Continue active investigation and remediation.';
    } else {
      nextActionText =
        'Incident acknowledged. Coordinate investigation and resolve once service is restored.';
    }
  }

  return (
    <section
      data-testid="incident-inspector"
      aria-label={`Incident details for ${incident.title}`}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors"
    >
      {/* Header */}
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/80 px-4 py-3 bg-muted/20">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {incident.priority ? (
              <PriorityBadge priority={incident.priority} size="sm" showLabel={false} />
            ) : (
              <Badge variant="neutral" size="xs" className="font-mono">
                P—
              </Badge>
            )}
            <span
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase',
                incident.urgency === 'HIGH'
                  ? 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400'
                  : incident.urgency === 'MEDIUM'
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400'
              )}
            >
              {incident.urgency} urgency
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                isTriggered
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
              )}
            >
              <span
                className={cn('h-1.5 w-1.5 rounded-full', isTriggered ? 'bg-rose-500' : 'bg-amber-500')}
                aria-hidden
              />
              {isTriggered ? 'Triggered' : 'Acknowledged'}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {formatIncidentAge(incident.createdAt, now)} ago
            </span>
          </div>
          <h2 className="mt-1.5 text-sm font-semibold leading-snug text-foreground break-words">
            {incident.title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/incidents/${incident.id}`}
            title="Open incident full page"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only">Open incident details</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            title="Close inspector (Esc)"
            data-testid="inspector-close"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close inspector</span>
          </button>
        </div>
      </header>

      {/* Action Strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/80 px-4 py-2.5 bg-muted/10">
        {showAck && (
          <button
            type="button"
            onClick={() => onAcknowledge(incident)}
            disabled={busy !== null}
            data-testid="inspector-ack"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            {busy === 'ack' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Acknowledge
            <kbd className="ml-0.5 rounded border border-amber-500/30 bg-amber-500/10 px-1 font-mono text-[9px] text-amber-800 dark:text-amber-300">
              A
            </kbd>
          </button>
        )}
        {showAssign && (
          <button
            type="button"
            onClick={() => onAssignSelf(incident)}
            disabled={busy !== null}
            data-testid="inspector-assign-me"
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {busy === 'assign' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            Assign to me
            <kbd className="ml-0.5 rounded border border-primary/30 bg-primary/10 px-1 font-mono text-[9px] text-primary">
              M
            </kbd>
          </button>
        )}
        <Link
          href={`/incidents/${incident.id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          View Full Details
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {/* Main Inspector Scrollable Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs">
        {/* Core Attributes */}
        <div className="space-y-2.5 rounded-lg border border-border/70 bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Service</span>
            <Link
              href={`/services/${incident.service.id}`}
              className="font-semibold text-foreground hover:text-primary hover:underline truncate"
            >
              {incident.service.name}
            </Link>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Team</span>
            <span className="font-medium text-foreground truncate">
              {incident.team?.name ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Urgency</span>
            <span
              className={cn(
                'rounded border px-1.5 py-0.2 font-mono text-[10px] font-semibold uppercase',
                incident.urgency === 'HIGH'
                  ? 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400'
                  : incident.urgency === 'MEDIUM'
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400'
              )}
            >
              {incident.urgency}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Assignee</span>
            <span className="font-medium text-foreground truncate">
              {incident.assignee?.name ?? (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">Unassigned</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">SLA Status</span>
            <SlaChip incident={incident} now={now} />
          </div>
        </div>

        {/* Service Automation & Runbooks Engine Context */}
        <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Workflow className="h-3.5 w-3.5 text-primary" aria-hidden />
            Automation & Escalation
          </div>
          <div className="space-y-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>Routing match:</span>
              {incident.routeRuleName ? (
                <span className="font-medium text-foreground truncate max-w-[65%]">
                  {incident.routeRuleName}
                </span>
              ) : (
                <span className="font-mono text-muted-foreground/60">Not configured</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Escalation state:</span>
              {escalationState ? (
                <span className="font-semibold text-foreground truncate max-w-[65%]">
                  {escalationState}
                </span>
              ) : (
                <span className="font-mono text-muted-foreground/60">Not configured</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Runbook execution:</span>
              {incident.latestRunbook ? (
                incident.latestRunbook.status === 'COMPLETED' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[65%]">
                    <Check className="h-3 w-3 shrink-0" aria-hidden />
                    {incident.latestRunbook.name}: Completed
                  </span>
                ) : incident.latestRunbook.status === 'FAILED' ? (
                  <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium truncate max-w-[65%]">
                    <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden />
                    {incident.latestRunbook.name}: Failed
                    {incident.latestRunbook.failureCode ? ` (${incident.latestRunbook.failureCode})` : ''}
                  </span>
                ) : incident.latestRunbook.status === 'RUNNING' || incident.latestRunbook.status === 'QUEUED' ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium truncate max-w-[65%]">
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                    {incident.latestRunbook.name}: In progress
                  </span>
                ) : (
                  <span className="font-medium text-muted-foreground truncate max-w-[65%]">
                    {incident.latestRunbook.name}: {incident.latestRunbook.status}
                  </span>
                )
              ) : (
                <span className="font-mono text-muted-foreground/60">No runbook executions</span>
              )}
            </div>
          </div>
        </div>

        {/* Alert & Trigger Telemetry */}
        <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-500" aria-hidden />
              Incoming Signals
            </div>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums font-mono text-muted-foreground">
              {incident.alertCount} signal{incident.alertCount === 1 ? '' : 's'}
            </span>
          </div>
          {incident.dedupKey ? (
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="text-zinc-500">Dedup key: </span>
              <code className="rounded border border-border/70 bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-foreground break-all">
                {incident.dedupKey}
              </code>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Direct alert trigger (no deduplication key assigned).
            </p>
          )}
        </div>

        {/* Actionable Guidance */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-[11px] space-y-1">
          <span className="font-semibold text-foreground">Recommended Next Action:</span>
          <p className="text-muted-foreground leading-relaxed">{nextActionText}</p>
        </div>
      </div>
    </section>
  );
}
