'use client';

import UserAvatar from '@/components/UserAvatar';
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
import PriorityBadge from '@/components/incident/PriorityBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import { type LiveIncident } from '@/lib/dashboard/live-incidents-shared';
import StatusBadge from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';
import RelativeTime from '@/components/patterns/RelativeTime';
import { SlaChip } from './LiveIncidentRow';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';

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
      nextActionText = 'SLA deadline approaching. Continue active investigation and remediation.';
    } else {
      nextActionText =
        'Incident acknowledged. Coordinate investigation and resolve once service is restored.';
    }
  }

  return (
    <section
      data-testid="incident-inspector"
      aria-label={`Incident details for ${incident.title}`}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      {/* Header */}
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {incident.priority ? (
              <PriorityBadge priority={incident.priority} size="sm" showLabel={false} />
            ) : (
              <Badge variant="neutral" size="xs" className="font-mono">
                P—
              </Badge>
            )}
            <SeverityBadge urgency={incident.urgency} size="xs" />
            <StatusBadge status={incident.status} size="xs" live={isTriggered} />
            <span className="text-2xs text-muted-foreground">
              <RelativeTime date={incident.createdAt} now={now} />
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
            className="rounded-md p-1 text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only">Open incident details</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            title="Close inspector (Esc)"
            data-testid="inspector-close"
            className="rounded-md p-1 text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close inspector</span>
          </button>
        </div>
      </header>

      {/* Action Strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        {showAck && (
          <button
            type="button"
            onClick={() => onAcknowledge(incident)}
            disabled={busy !== null}
            data-testid="inspector-ack"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold outline-none transition-colors duration-150 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
              toneClasses('elevated').soft
            )}
          >
            {busy === 'ack' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Acknowledge
            <kbd className="ml-0.5 rounded-sm border border-current px-1 font-mono text-2xs opacity-80">
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
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {busy === 'assign' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            )}
            Assign to me
            <kbd className="ml-0.5 rounded-sm border border-border bg-muted px-1 font-mono text-2xs text-muted-foreground">
              M
            </kbd>
          </button>
        )}
        <Link
          href={`/incidents/${incident.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          View Full Details
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {/* Main Inspector Scrollable Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 text-xs">
        {/* Core Attributes */}
        <div className="space-y-2.5 rounded-md border border-border bg-muted/30 p-3">
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
            <SeverityBadge urgency={incident.urgency} size="xs" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Assignee</span>
            {incident.assignee ? (
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                <UserAvatar
                  userId={incident.assignee.id}
                  avatarUrl={incident.assignee.avatarUrl}
                  name={incident.assignee.name}
                  gender={incident.assignee.gender}
                  size="xs"
                  aria-hidden
                />
                <span className="truncate">{incident.assignee.name}</span>
              </span>
            ) : (
              <span className={cn(toneClasses('elevated').text, 'font-semibold')}>Unassigned</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">SLA Status</span>
            <SlaChip incident={incident} now={now} />
          </div>
        </div>

        {/* Service Automation & Runbooks Engine Context */}
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Workflow className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            Automation & Escalation
          </div>
          <div className="space-y-1.5 text-2xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>Routing match:</span>
              {incident.routeRuleName ? (
                <span className="font-medium text-foreground truncate max-w-[65%]">
                  {incident.routeRuleName}
                </span>
              ) : (
                <span className="font-mono text-muted-foreground">Not configured</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Escalation state:</span>
              {escalationState ? (
                <span className="font-semibold text-foreground truncate max-w-[65%]">
                  {escalationState}
                </span>
              ) : (
                <span className="font-mono text-muted-foreground">Not configured</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Runbook execution:</span>
              {incident.latestRunbook ? (
                incident.latestRunbook.status === 'COMPLETED' ? (
                  <span
                    className={cn(
                      'inline-flex max-w-[65%] items-center gap-1 truncate font-medium',
                      toneClasses('ok').text
                    )}
                  >
                    <Check className="h-3 w-3 shrink-0" aria-hidden />
                    {incident.latestRunbook.name}: Completed
                  </span>
                ) : incident.latestRunbook.status === 'FAILED' ? (
                  <span
                    className={cn(
                      'inline-flex max-w-[65%] items-center gap-1 truncate font-medium',
                      toneClasses('critical').text
                    )}
                  >
                    <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden />
                    {incident.latestRunbook.name}: Failed
                    {incident.latestRunbook.failureCode
                      ? ` (${incident.latestRunbook.failureCode})`
                      : ''}
                  </span>
                ) : incident.latestRunbook.status === 'RUNNING' ||
                  incident.latestRunbook.status === 'QUEUED' ? (
                  <span
                    className={cn(
                      'inline-flex max-w-[65%] items-center gap-1 truncate font-medium',
                      toneClasses('elevated').text
                    )}
                  >
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                    {incident.latestRunbook.name}: In progress
                  </span>
                ) : (
                  <span className="font-medium text-muted-foreground truncate max-w-[65%]">
                    {incident.latestRunbook.name}: {incident.latestRunbook.status}
                  </span>
                )
              ) : (
                <span className="font-mono text-muted-foreground">No runbook executions</span>
              )}
            </div>
          </div>
        </div>

        {/* Alert & Trigger Telemetry */}
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              Incoming Signals
            </div>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-muted-foreground">
              {incident.alertCount} signal{incident.alertCount === 1 ? '' : 's'}
            </span>
          </div>
          {incident.dedupKey ? (
            <div className="text-2xs leading-relaxed text-muted-foreground">
              <span>Dedup key: </span>
              <code className="break-all rounded-sm border border-border bg-muted/60 px-1 py-0.5 font-mono text-2xs text-foreground">
                {incident.dedupKey}
              </code>
            </div>
          ) : (
            <p className="text-2xs leading-relaxed text-muted-foreground">
              Direct alert trigger (no deduplication key assigned).
            </p>
          )}
        </div>

        {/* Actionable Guidance */}
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <span className="font-semibold text-foreground">Recommended Next Action:</span>
          <p className="text-muted-foreground leading-relaxed">{nextActionText}</p>
        </div>
      </div>
    </section>
  );
}
