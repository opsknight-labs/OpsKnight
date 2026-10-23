'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Incident, Service } from '@prisma/client';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
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
import EscalationStatusBadge from './EscalationStatusBadge';
import AssigneeSection from './AssigneeSection';
import PrioritySelector from './PrioritySelector';

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
}: IncidentHeaderProps) {
  const { userTimeZone } = useTimezone();
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

  const currentVisibility = incident.visibility || 'PUBLIC';
  const isPrivate = currentVisibility === 'PRIVATE';

  // Status-adaptive card accent
  const getStatusBorder = () => {
    switch (incident.status) {
      case 'OPEN':
        return 'border-l-4 border-l-rose-500';
      case 'ACKNOWLEDGED':
        return 'border-l-4 border-l-amber-500';
      case 'RESOLVED':
        return 'border-l-4 border-l-emerald-500';
      case 'SNOOZED':
        return 'border-l-4 border-l-indigo-500';
      case 'SUPPRESSED':
        return 'border-l-4 border-l-zinc-500';
      default:
        return 'border-l-4 border-l-muted-foreground';
    }
  };

  const urgencyDot =
    incident.urgency === 'HIGH'
      ? 'bg-rose-500 animate-pulse'
      : incident.urgency === 'MEDIUM'
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  const SELECTOR_BASE_CLASS =
    'inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold bg-background border border-border/80 text-foreground shadow-2xs transition-all max-w-full select-none hover:bg-muted/40 hover:border-border';

  const durationText = incident.resolvedAt
    ? `Resolved in ${formatDuration(incident.createdAt, incident.resolvedAt)}`
    : `Open for ${formatDuration(incident.createdAt, null)}`;

  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden transition-all text-card-foreground',
        getStatusBorder()
      )}
    >
      {/* Unified 7-cell grid — all metadata in equal rhythm */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 divide-x divide-y xl:divide-y-0 divide-border/60">
        {/* Priority */}
        <div className="flex flex-col justify-center px-3 py-2 min-h-[52px]">
          <div className="flex items-center gap-1 mb-1">
            <Activity className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
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
        <div className="flex flex-col justify-center px-3 py-2 min-h-[52px]">
          <div className="flex items-center gap-1 mb-1">
            <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
              Urgency
            </span>
          </div>
          {canManage ? (
            <Select
              value={incident.urgency}
              onValueChange={handleUrgencyChange}
              disabled={isPending}
            >
              <SelectTrigger className="h-auto w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden group">
                <div className={cn(SELECTOR_BASE_CLASS, 'cursor-pointer group')}>
                  <span className={cn('h-2 w-2 rounded-full shrink-0', urgencyDot)} />
                  <span>{incident.urgency}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-auto" />
                </div>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-[150px]">
                <SelectItem value="HIGH" className="cursor-pointer">
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span>HIGH</span>
                  </div>
                </SelectItem>
                <SelectItem value="MEDIUM" className="cursor-pointer">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span>MEDIUM</span>
                  </div>
                </SelectItem>
                <SelectItem value="LOW" className="cursor-pointer">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span>LOW</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className={cn(SELECTOR_BASE_CLASS, 'cursor-default')}>
              <span className={cn('h-2 w-2 rounded-full shrink-0', urgencyDot)} />
              <span>{incident.urgency}</span>
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="flex flex-col justify-center px-3 py-2 min-h-[52px]">
          <div className="flex items-center gap-1 mb-1">
            {isPrivate ? (
              <EyeOff className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
              Visibility
            </span>
          </div>
          {canManage ? (
            <Select
              value={currentVisibility}
              onValueChange={val => handleVisibilityChange(val as 'PUBLIC' | 'PRIVATE')}
              disabled={isPending}
            >
              <SelectTrigger className="h-auto w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden group">
                <div className={cn(SELECTOR_BASE_CLASS, 'cursor-pointer group')}>
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
            <div className={cn(SELECTOR_BASE_CLASS, 'cursor-default')}>
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
          title={`Service: ${incident.service.name}`}
          className="group flex flex-col justify-center px-3 py-2 min-h-[52px] hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-1 mb-1">
            <Server className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
              Service
            </span>
          </div>
          <div className="flex items-center gap-1 max-w-full">
            <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {incident.service.name}
            </span>
            <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
          </div>
        </Link>

        {/* Assignee */}
        <div className="flex flex-col justify-center px-3 py-2 min-h-[52px]">
          <div className="flex items-center gap-1 mb-1">
            <Users className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
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
            title={`Escalation Policy: ${incident.incidentPolicy.name}`}
            className="group flex flex-col justify-center px-3 py-2 min-h-[52px] hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-1 mb-1">
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
                Incident policy
              </span>
            </div>
            <div className="flex items-center gap-1 max-w-full">
              <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                {incident.incidentPolicy.name}
              </span>
              <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
            </div>
          </Link>
        ) : (
          <div className="flex flex-col justify-center px-3 py-2 min-h-[52px] opacity-60">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
                Incident policy
              </span>
            </div>
            <span className="text-xs text-muted-foreground italic">
              {incident.noEscalation ? 'Personal paging skipped' : 'None'}
            </span>
          </div>
        )}

        {/* Escalation */}
        <div className="flex flex-col justify-center px-3 py-2 min-h-[52px]">
          <div className="flex items-center gap-1 mb-1">
            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-wider">
              Escalation
            </span>
          </div>
          {(() => {
            // Case 1: Incident is Resolved
            if (incident.status === 'RESOLVED') {
              return (
                <div
                  className={cn(SELECTOR_BASE_CLASS, 'cursor-default text-foreground/80')}
                  title="Escalation ended upon resolution"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span>Completed</span>
                </div>
              );
            }

            // Case 2: Incident is Snoozed or Suppressed
            if (incident.status === 'SNOOZED' || incident.status === 'SUPPRESSED') {
              return (
                <div
                  className={cn(
                    SELECTOR_BASE_CLASS,
                    'cursor-default text-indigo-700 dark:text-indigo-400'
                  )}
                  title="Escalation paused while incident is snoozed/suppressed"
                >
                  <Pause className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
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
                  className={cn(
                    SELECTOR_BASE_CLASS,
                    'cursor-default text-emerald-800 dark:text-emerald-400'
                  )}
                  title="Escalation stopped because incident was acknowledged"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
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
                  className={cn(
                    SELECTOR_BASE_CLASS,
                    'cursor-default text-rose-800 dark:text-rose-400'
                  )}
                  title="All escalation policy steps have been exhausted"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>Max Step Reached</span>
                </div>
              );
            }

            // Default fallback
            return <span className="text-xs text-muted-foreground italic">None</span>;
          })()}
        </div>
      </div>

      {/* Balanced, enriched compact footer bar */}
      <div className="border-t border-border/50 bg-muted/15 px-3 py-1.5 flex flex-wrap items-center justify-between gap-y-1 text-xs text-muted-foreground">
        {/* Left: Timestamps + duration */}
        <div className="flex items-center gap-x-3.5 gap-y-0.5 flex-wrap text-[11px] font-medium">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span>
              Created {formatDateTime(incident.createdAt, userTimeZone, { format: 'relative' })}
            </span>
          </div>
          {incident.acknowledgedAt && (
            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <CheckCircle2 className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span>
                Ack&apos;d{' '}
                {formatDateTime(incident.acknowledgedAt, userTimeZone, { format: 'relative' })}
              </span>
            </div>
          )}
          {incident.resolvedAt && (
            <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span>
                Resolved {formatDateTime(incident.resolvedAt, userTimeZone, { format: 'relative' })}
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
    </div>
  );
}
