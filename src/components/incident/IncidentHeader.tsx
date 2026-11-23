'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Incident, Service } from '@prisma/client';
import CopyButton from '@/components/common/CopyButton';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/shadcn/select';
import { updateIncidentUrgency, updateIncidentVisibility } from '@/app/(app)/incidents/actions';
import {
  Eye,
  EyeOff,
  Clock,
  CheckCircle2,
  Server,
  Shield,
  Users,
  AlertTriangle,
  Activity,
  ArrowUpRight,
  ChevronDown,
  Timer,
  Pause,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_SELECT_CLASS, FIELD_VALUE_CLASS } from '@/components/incident/field-styles';
import { incidentStatusTone, urgencyTone } from '@/lib/design/status-palette';
import { toneClasses } from '@/components/patterns/status-tone';
import SeverityBadge from '@/components/patterns/SeverityBadge';
import RelativeTime from '@/components/patterns/RelativeTime';
import EscalationStatusBadge from './EscalationStatusBadge';
import AssigneeSection from './AssigneeSection';
import PrioritySelector from './PrioritySelector';
import TruncatedText from '@/components/patterns/TruncatedText';

type IncidentHeaderProps = {
  incident: Incident & {
    noEscalation?: boolean;
    incidentPolicy?: { id: string; name: string } | null;
    service: Service & {
      policy?: { id: string; name: string } | null;
    };
    assignee: {
      id: string;
      name: string;
      email: string;
      avatarUrl?: string | null;
      gender?: string | null;
    } | null;
    team?: { id: string; name: string } | null;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
    role?: string;
  }>;
  teams: Array<{ id: string; name: string }>;
  canManage: boolean;
  routePrefix?: string;
  /**
   * Rendered as the bottom band of the incident title card: no card chrome of its own,
   * timing becomes the last cell, and the ID is left to the title row.
   */
  embedded?: boolean;
  /** Escalation execution health, shown as the second line of the Escalation field. */
  escalationHealth?: React.ReactNode;
};

function formatDuration(startDate: Date, endDate: Date | null): string {
  const start = new Date(startDate).getTime();
  const end = endDate ? new Date(endDate).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const totalMins = Math.floor(diffMs / 60000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export default function IncidentHeader({
  incident,
  users,
  teams,
  canManage,
  routePrefix = '',
  embedded = false,
  escalationHealth,
}: IncidentHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleVisibilityChange = (newVisibility: 'PUBLIC' | 'PRIVATE') => {
    startTransition(async () => {
      await updateIncidentVisibility(incident.id, newVisibility);
      router.refresh();
    });
  };

  const handleUrgencyChange = (newUrgency: string) => {
    startTransition(async () => {
      await updateIncidentUrgency(incident.id, newUrgency);
      router.refresh();
    });
  };

  const urgencyLabel = incident.urgency.charAt(0) + incident.urgency.slice(1).toLowerCase();
  const currentVisibility = incident.visibility || 'PUBLIC';
  const isPrivate = currentVisibility === 'PRIVATE';

  const statusAccent = cn(
    'border-l-4',
    toneClasses(incidentStatusTone(incident.status)).borderLeft
  );
  const urgencyDot = cn(
    toneClasses(urgencyTone(incident.urgency)).solid,
    incident.urgency === 'HIGH' && 'motion-safe:animate-pulse'
  );

  const durationText = incident.resolvedAt
    ? `Resolved in ${formatDuration(incident.createdAt, incident.resolvedAt)}`
    : `Open for ${formatDuration(incident.createdAt, null)}`;

  // Boxed cells: uppercase label on top, value below. items-start stops chips stretching to the cell width.
  // Embedded (title card band): one line of content-sized cells; only assignee and policy may shrink.
  const cellClass = embedded
    ? 'flex min-w-0 shrink-0 flex-col items-start justify-start px-3 py-2'
    : 'flex min-h-[52px] min-w-0 flex-col items-start justify-start px-3 py-2.5';
  const shrinkCell = embedded ? 'shrink' : '';
  const labelClass = 'mb-1 flex items-center gap-1 whitespace-nowrap';
  const linkCell = 'hover:bg-muted/40 transition-colors';

  return (
    <div
      className={cn(
        'overflow-hidden text-card-foreground',
        embedded
          ? 'border-t border-border/70 bg-muted/20'
          : cn('rounded-xl border border-border/80 bg-card shadow-2xs transition-all', statusAccent)
      )}
    >
      {/* Embedded: one row on desktop (wraps on phones). Standalone: 7 equal cells + footer. */}
      <div
        className={cn(
          embedded
            ? 'flex flex-wrap divide-x divide-border/60 lg:flex-nowrap'
            : 'grid grid-cols-2 divide-x divide-y divide-border/60 sm:grid-cols-3 xl:grid-cols-7 xl:divide-y-0'
        )}
      >
        {/* Priority */}
        <div className={cellClass}>
          <div className={labelClass}>
            <Activity className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              Priority
            </span>
          </div>
          <PrioritySelector
            incidentId={incident.id}
            priority={incident.priority}
            canManage={canManage}
          />
        </div>

        {/* Urgency */}
        <div className={cellClass}>
          <div className={labelClass}>
            <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              Urgency
            </span>
          </div>
          {canManage ? (
            <Select
              value={incident.urgency}
              onValueChange={handleUrgencyChange}
              disabled={isPending}
            >
              <SelectTrigger
                aria-label={`Urgency: ${incident.urgency}`}
                className="h-auto w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-ring rounded-md [&>svg]:hidden group"
              >
                <div className={FIELD_SELECT_CLASS}>
                  <span className={cn('h-2 w-2 rounded-full shrink-0', urgencyDot)} />
                  <span>{urgencyLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-auto" />
                </div>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[150px]">
                {(['HIGH', 'MEDIUM', 'LOW'] as const).map(value => (
                  <SelectItem key={value} value={value} className="cursor-pointer">
                    <SeverityBadge urgency={value} size="xs" />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className={FIELD_VALUE_CLASS}>
              <span className={cn('h-2 w-2 rounded-full shrink-0', urgencyDot)} />
              <span>{urgencyLabel}</span>
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className={cellClass}>
          <div className={labelClass}>
            {isPrivate ? (
              <EyeOff className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              Visibility
            </span>
          </div>
          {canManage ? (
            <Select
              value={currentVisibility}
              onValueChange={val => handleVisibilityChange(val as 'PUBLIC' | 'PRIVATE')}
              disabled={isPending}
            >
              <SelectTrigger
                aria-label={`Visibility: ${isPrivate ? 'Private' : 'Public'}`}
                className="h-auto w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-ring rounded-md [&>svg]:hidden group"
              >
                <div className={FIELD_SELECT_CLASS}>
                  {isPrivate ? (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span>{isPrivate ? 'Private' : 'Public'}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-auto" />
                </div>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[150px]">
                <SelectItem value="PUBLIC" className="cursor-pointer">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>Public</span>
                  </div>
                </SelectItem>
                <SelectItem value="PRIVATE" className="cursor-pointer">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>Private</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className={FIELD_VALUE_CLASS}>
              {isPrivate ? (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span>{isPrivate ? 'Private' : 'Public'}</span>
            </div>
          )}
        </div>

        {/* Service */}
        <Link
          href={`${routePrefix}/services/${incident.serviceId}`}
          className={cn(cellClass, 'group', linkCell)}
        >
          <div className={labelClass}>
            <Server className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              Service
            </span>
          </div>
          <div className="flex h-8 min-w-0 max-w-full items-center gap-1">
            <TruncatedText
              text={incident.service.name}
              className="text-sm font-medium text-foreground group-hover:text-primary transition-colors"
            />
            <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
          </div>
        </Link>

        {/* Assignee */}
        <div className={cn(cellClass, shrinkCell)}>
          <div className={labelClass}>
            <Users className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              Assignee
            </span>
          </div>
          <AssigneeSection
            assignee={incident.assignee}
            team={incident.team || null}
            assigneeId={incident.assigneeId}
            teamId={incident.teamId}
            users={users}
            teams={teams}
            incidentId={incident.id}
            canManage={canManage}
            variant="header"
          />
        </div>

        {/* Policy */}
        {incident.incidentPolicy ? (
          <Link
            href={`${routePrefix}/policies/${incident.incidentPolicy.id}`}
            className={cn(cellClass, shrinkCell, 'group', linkCell)}
          >
            <div className={labelClass}>
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                Incident policy
              </span>
            </div>
            <div className="flex h-8 min-w-0 max-w-full items-center gap-1">
              <TruncatedText
                text={incident.incidentPolicy.name}
                className="text-sm font-medium text-foreground group-hover:text-primary transition-colors"
              />
              <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
            </div>
          </Link>
        ) : (
          <div className={cn(cellClass, shrinkCell, 'opacity-60')}>
            <div className={labelClass}>
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                Incident policy
              </span>
            </div>
            <span className="text-xs text-muted-foreground italic">
              {incident.noEscalation ? 'Personal paging skipped' : 'None'}
            </span>
          </div>
        )}

        {/* Escalation */}
        <div className={cellClass}>
          <div className={labelClass}>
            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
              Escalation
            </span>
          </div>
          {(() => {
            // Case 1: Incident is Resolved
            if (incident.status === 'RESOLVED') {
              return (
                <div
                  className={cn(FIELD_VALUE_CLASS, 'text-foreground/80')}
                  title="Escalation ended upon resolution"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 dark:text-emerald-400" />
                  <span>Completed</span>
                </div>
              );
            }

            // Case 2: Incident is Snoozed or Suppressed
            if (incident.status === 'SNOOZED' || incident.status === 'SUPPRESSED') {
              return (
                <div
                  className={cn(FIELD_VALUE_CLASS, ' text-indigo-700 dark:text-indigo-400')}
                  title="Escalation paused while incident is snoozed/suppressed"
                >
                  <Pause className="h-3.5 w-3.5 text-indigo-600 shrink-0 dark:text-indigo-400" />
                  <span>Paused</span>
                </div>
              );
            }

            // Case 3: Incident is Acknowledged -> Escalation Stopped / On Hold
            if (incident.status === 'ACKNOWLEDGED' || incident.escalationStatus === 'PAUSED') {
              const stepLabel =
                incident.currentEscalationStep !== null &&
                incident.currentEscalationStep !== undefined
                  ? `Stopped at Step ${incident.currentEscalationStep + 1}`
                  : 'Stopped (Acked)';
              return (
                <div
                  className={cn(FIELD_VALUE_CLASS, ' text-emerald-800 dark:text-emerald-400')}
                  title="Escalation stopped because incident was acknowledged"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 dark:text-emerald-400" />
                  <span className="truncate">{stepLabel}</span>
                </div>
              );
            }

            // Case 4: Actively Escalating (Unacknowledged & Escalating)
            if (incident.escalationStatus === 'ESCALATING') {
              return (
                <EscalationStatusBadge
                  status={incident.escalationStatus}
                  currentStep={incident.currentEscalationStep}
                  nextEscalationAt={incident.nextEscalationAt}
                  size="sm"
                  className="h-7 text-xs"
                />
              );
            }

            // Case 5: Escalation steps fully completed without ack
            if (incident.escalationStatus === 'COMPLETED') {
              return (
                <div
                  className={cn(FIELD_VALUE_CLASS, ' text-rose-800 dark:text-rose-400')}
                  title="All escalation policy steps have been exhausted"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 dark:text-rose-400" />
                  <span className="truncate">Max Step Reached</span>
                </div>
              );
            }

            // Default fallback
            return <span className="text-xs text-muted-foreground italic">None</span>;
          })()}
          {escalationHealth}
        </div>

        {/* Timing: in the title card it is the last cell, not a separate footer bar. */}
        {embedded && (
          <div className={cellClass}>
            <div className={labelClass}>
              <Timer className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                Opened
              </span>
            </div>
            <span className="flex h-8 items-center text-sm font-medium text-foreground">
              <RelativeTime date={incident.createdAt} />
            </span>
            <span className="text-2xs text-muted-foreground">
              {durationText}
              {incident.acknowledgedAt && !incident.resolvedAt && (
                <>
                  {' · '}ack&apos;d <RelativeTime date={incident.acknowledgedAt} />
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {!embedded && (
        <div className="border-t border-border/50 bg-muted/15 px-3 py-1.5 flex flex-wrap items-center justify-between gap-y-1 text-xs text-muted-foreground">
          {/* Left: Timestamps + duration */}
          <div className="flex items-center gap-x-3.5 gap-y-0.5 flex-wrap text-[11px] font-medium">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span>
                Created <RelativeTime date={incident.createdAt} />
              </span>
            </div>
            {incident.acknowledgedAt && (
              <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <CheckCircle2 className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                <span>
                  Ack&apos;d <RelativeTime date={incident.acknowledgedAt} />
                </span>
              </div>
            )}
            {incident.resolvedAt && (
              <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Resolved <RelativeTime date={incident.resolvedAt} />
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 text-foreground/80">
              <Timer className="h-3 w-3 text-muted-foreground" />
              <span>{durationText}</span>
            </div>
          </div>

          {/* Right: Quick reference */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              #{incident.id.slice(0, 8)}
            </span>
            <CopyButton
              text={incident.id}
              label="Copy ID"
              className="text-muted-foreground hover:text-foreground hover:bg-muted/60 h-5 px-1.5 text-[10px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
