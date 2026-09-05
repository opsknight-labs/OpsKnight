'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Incident, Service } from '@prisma/client';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import UserAvatar from '@/components/UserAvatar';
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
  User,
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

export default function IncidentHeader({ incident, users, teams, canManage }: IncidentHeaderProps) {
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
        return 'border-l-4 border-l-rose-500 bg-gradient-to-r from-rose-50/20 via-white to-white';
      case 'ACKNOWLEDGED':
        return 'border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-50/20 via-white to-white';
      case 'RESOLVED':
        return 'border-l-4 border-l-emerald-500 bg-gradient-to-r from-emerald-50/20 via-white to-white';
      case 'SNOOZED':
        return 'border-l-4 border-l-indigo-500 bg-gradient-to-r from-indigo-50/20 via-white to-white';
      case 'SUPPRESSED':
        return 'border-l-4 border-l-zinc-500 bg-gradient-to-r from-zinc-50/20 via-white to-white';
      default:
        return 'border-l-4 border-l-slate-400 bg-white';
    }
  };

  const urgencyDot =
    incident.urgency === 'HIGH'
      ? 'bg-rose-500 animate-pulse'
      : incident.urgency === 'MEDIUM'
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  const urgencyTone =
    incident.urgency === 'HIGH'
      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
      : incident.urgency === 'MEDIUM'
        ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';

  const durationText = incident.resolvedAt
    ? `Resolved in ${formatDuration(incident.createdAt, incident.resolvedAt)}`
    : `Open for ${formatDuration(incident.createdAt, null)}`;

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all',
        getStatusBorder()
      )}
    >
      {/* Unified 7-cell grid — all metadata in equal rhythm */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 divide-x divide-y divide-slate-100">
        {/* Priority */}
        <div className="flex flex-col justify-center p-3.5 min-h-[74px]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Activity className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
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
        <div className="flex flex-col justify-center p-3.5 min-h-[74px]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Urgency
            </span>
          </div>
          {canManage ? (
            <Select
              value={incident.urgency}
              onValueChange={handleUrgencyChange}
              disabled={isPending}
            >
              <SelectTrigger className="h-8 w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden group">
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-sm font-semibold transition-all shadow-2xs group-hover:brightness-95 cursor-pointer',
                    urgencyTone
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', urgencyDot)} />
                  <span>{incident.urgency}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">
                  <div className="flex items-center gap-2 font-semibold text-rose-700">
                    <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    HIGH
                  </div>
                </SelectItem>
                <SelectItem value="MEDIUM">
                  <div className="flex items-center gap-2 font-semibold text-amber-700">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    MEDIUM
                  </div>
                </SelectItem>
                <SelectItem value="LOW">
                  <div className="flex items-center gap-2 font-semibold text-emerald-700">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    LOW
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-sm font-semibold w-fit shadow-2xs',
                urgencyTone
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', urgencyDot)} />
              <span>{incident.urgency}</span>
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="flex flex-col justify-center p-3.5 min-h-[74px]">
          <div className="flex items-center gap-1.5 mb-1.5">
            {isPrivate ? (
              <EyeOff className="h-3 w-3 text-slate-400 shrink-0" />
            ) : (
              <Eye className="h-3 w-3 text-slate-400 shrink-0" />
            )}
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Visibility
            </span>
          </div>
          {canManage ? (
            <Select
              value={currentVisibility}
              onValueChange={val => handleVisibilityChange(val as 'PUBLIC' | 'PRIVATE')}
              disabled={isPending}
            >
              <SelectTrigger className="h-8 w-fit border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden group">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold shadow-2xs group-hover:bg-slate-100 group-hover:border-slate-300 transition-all cursor-pointer">
                  {isPrivate ? (
                    <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 text-slate-500" />
                  )}
                  <span>{isPrivate ? 'Private' : 'Public'}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">
                  <div className="flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5 text-slate-500" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-slate-900">Public</span>
                      <span className="text-[10px] text-slate-500">Visible on Status Page</span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="PRIVATE">
                  <div className="flex items-center gap-2">
                    <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-slate-900">Private</span>
                      <span className="text-[10px] text-slate-500">Internal Dashboard Only</span>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-800 text-sm font-semibold w-fit shadow-2xs">
              {isPrivate ? (
                <EyeOff className="h-3.5 w-3.5 text-slate-500" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-slate-500" />
              )}
              <span>{isPrivate ? 'Private' : 'Public'}</span>
            </div>
          )}
        </div>

        {/* Service */}
        <Link
          href={`/services/${incident.serviceId}`}
          title={`Service: ${incident.service.name}`}
          className="group flex flex-col justify-center p-3.5 min-h-[74px] hover:bg-slate-50/80 transition-colors"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Server className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Service
            </span>
          </div>
          <div className="flex items-center gap-1.5 max-w-full">
            <span className="text-sm font-semibold text-slate-900 group-hover:text-primary transition-colors truncate">
              {incident.service.name}
            </span>
            <ArrowUpRight className="h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
          </div>
        </Link>

        {/* Assignee */}
        <div className="flex flex-col justify-center p-3.5 min-h-[74px] relative">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Users className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Assignee
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0 pr-6">
            {incident.team ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-900 text-sm font-semibold shadow-2xs truncate">
                <Users className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                <span className="truncate">{incident.team.name}</span>
              </div>
            ) : incident.assignee ? (
              <div className="inline-flex items-center gap-1.5 min-w-0">
                <UserAvatar
                  userId={incident.assignee.id}
                  name={incident.assignee.name}
                  gender={incident.assignee.gender}
                  avatarUrl={incident.assignee.avatarUrl}
                  size="xs"
                  className="border-slate-200 shrink-0"
                />
                <span className="text-sm font-semibold text-slate-900 truncate">
                  {incident.assignee.name}
                </span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-50 border border-dashed border-slate-300 text-slate-500 text-sm font-semibold">
                <User className="h-3.5 w-3.5" />
                <span>Unassigned</span>
              </div>
            )}
          </div>
          {canManage && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
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
          )}
        </div>

        {/* Policy */}
        {incident.service.policy ? (
          <Link
            href={`/policies/${incident.service.policy.id}`}
            title={`Escalation Policy: ${incident.service.policy.name}`}
            className="group flex flex-col justify-center p-3.5 min-h-[74px] hover:bg-slate-50/80 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Shield className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Policy
              </span>
            </div>
            <div className="flex items-center gap-1.5 max-w-full">
              <span className="text-sm font-semibold text-slate-900 group-hover:text-primary transition-colors truncate">
                {incident.service.policy.name}
              </span>
              <ArrowUpRight className="h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
            </div>
          </Link>
        ) : (
          <div className="flex flex-col justify-center p-3.5 min-h-[74px] opacity-60">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Shield className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Policy
              </span>
            </div>
            <span className="text-sm text-slate-400 italic">None</span>
          </div>
        )}

        {/* Escalation */}
        <div className="flex flex-col justify-center p-3.5 min-h-[74px]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Clock className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Escalation
            </span>
          </div>
          {(() => {
            // Case 1: Incident is Resolved
            if (incident.status === 'RESOLVED') {
              return (
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold w-fit shadow-2xs"
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
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold w-fit shadow-2xs"
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
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold w-fit shadow-2xs"
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
                />
              );
            }

            // Case 5: Escalation steps fully completed without ack
            if (incident.escalationStatus === 'COMPLETED') {
              return (
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold w-fit shadow-2xs"
                  title="All escalation policy steps have been exhausted"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>Max Step Reached</span>
                </div>
              );
            }

            // Default fallback
            return <span className="text-sm text-slate-400 italic">None</span>;
          })()}
        </div>
      </div>

      {/* Balanced, enriched footer bar */}
      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 flex flex-wrap items-center justify-between gap-y-1.5 text-xs text-slate-500">
        {/* Left: Timestamps + duration */}
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap font-medium">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-slate-400" />
            <span>
              Created {formatDateTime(incident.createdAt, userTimeZone, { format: 'relative' })}
            </span>
          </div>
          {incident.acknowledgedAt && (
            <div className="flex items-center gap-1.5 text-amber-700">
              <CheckCircle2 className="h-3 w-3 text-amber-600" />
              <span>
                Ack&apos;d{' '}
                {formatDateTime(incident.acknowledgedAt, userTimeZone, { format: 'relative' })}
              </span>
            </div>
          )}
          {incident.resolvedAt && (
            <div className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              <span>
                Resolved {formatDateTime(incident.resolvedAt, userTimeZone, { format: 'relative' })}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-slate-600">
            <Timer className="h-3 w-3 text-slate-400" />
            <span>{durationText}</span>
          </div>
        </div>

        {/* Right: Quick reference */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-400">#{incident.id.slice(0, 8)}</span>
          <CopyButton
            text={incident.id}
            label="Copy ID"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 h-6 px-1.5 text-[11px]"
          />
        </div>
      </div>
    </div>
  );
}
