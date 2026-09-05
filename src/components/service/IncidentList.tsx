'use client';

import { memo, useTransition } from 'react';
import { IncidentStatus } from '@prisma/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import StatusBadge from '../incident/StatusBadge';
import PriorityBadge from '@/components/incident/PriorityBadge';
import UserAvatar from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  CheckCircle2,
  Users as UsersIcon,
  User as UserIcon,
  MoreHorizontal,
  Eye,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import CreateIncidentButton from '@/components/incident/CreateIncidentButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { useToast } from '@/hooks/use-product-notification';

// Helper to format relative time
function formatDistanceToNow(date: Date, timeZone: string): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateTime(date, timeZone, { format: 'date' });
}

type Incident = {
  id: string;
  title: string;
  status: IncidentStatus;
  urgency: string;
  priority: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  assignee: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  team: {
    id: string;
    name: string;
  } | null;
};

type IncidentListProps = {
  incidents: Incident[];
  serviceId: string;
};

function getStatusAccentBar(status: IncidentStatus): string {
  switch (status) {
    case 'OPEN':
      return 'bg-rose-500';
    case 'ACKNOWLEDGED':
      return 'bg-blue-600';
    case 'RESOLVED':
      return 'bg-emerald-500';
    case 'SNOOZED':
    case 'SUPPRESSED':
    default:
      return 'bg-slate-400';
  }
}

function getStatusHoverBorder(status: IncidentStatus): string {
  switch (status) {
    case 'OPEN':
      return 'hover:border-rose-300/80 dark:hover:border-rose-800/60';
    case 'ACKNOWLEDGED':
      return 'hover:border-blue-300/80 dark:hover:border-blue-800/60';
    case 'RESOLVED':
      return 'hover:border-emerald-300/80 dark:hover:border-emerald-800/60';
    case 'SNOOZED':
    case 'SUPPRESSED':
    default:
      return 'hover:border-slate-300/80 dark:hover:border-slate-700/60';
  }
}

function buildUrgencyChip(urgency: string | null | undefined) {
  if (!urgency) return null;
  const u = urgency.toUpperCase();
  const variant = u === 'HIGH' ? 'danger' : u === 'MEDIUM' ? 'warning' : 'success';

  return (
    <Badge variant={variant} size="xs" className="uppercase" title={`Urgency: ${u}`}>
      {u}
    </Badge>
  );
}

function IncidentList({ incidents, serviceId }: IncidentListProps) {
  const { userTimeZone } = useTimezone();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const handleStatusChange = (incidentId: string, newStatus: IncidentStatus) => {
    startTransition(async () => {
      try {
        await updateIncidentStatus(incidentId, newStatus);
        showToast(`Incident ${newStatus.toLowerCase()} successfully`, 'success');
        router.refresh();
      } catch {
        showToast('Failed to update status', 'error');
      }
    });
  };

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-card text-card-foreground">
        <div className="bg-muted/60 p-4 rounded-full mb-4 ring-1 ring-border">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-1">No incidents recorded</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          This service is running smoothly with no recorded incidents.
        </p>
        <CreateIncidentButton serviceId={serviceId} />
      </div>
    );
  }

  return (
    <div className="p-3 md:p-4 lg:p-5">
      <div className="flex flex-col gap-3">
        {incidents.map(incident => {
          const incidentStatus = incident.status;

          return (
            <div
              key={incident.id}
              className={cn(
                'group relative rounded-2xl border bg-card transition-all duration-150 overflow-hidden cursor-pointer',
                'hover:shadow-md hover:-translate-y-[1px]',
                'focus-within:ring-2 focus-within:ring-primary/20',
                'border-border',
                getStatusHoverBorder(incidentStatus)
              )}
              onClick={e => {
                const target = e.target as HTMLElement;
                if (target.closest('[data-no-row-nav="true"]')) return;
                router.push(`/incidents/${incident.id}`);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/incidents/${incident.id}`);
                }
              }}
            >
              {/* Left status indicator pill */}
              <div
                className={cn(
                  'absolute left-0 top-3 bottom-3 w-1 rounded-r-full transition-all duration-200',
                  getStatusAccentBar(incidentStatus),
                  'opacity-80 group-hover:opacity-100 group-hover:w-1.25'
                )}
              />

              <div className="flex gap-3 items-center pl-4 pr-3.5 py-3.5 md:py-4">
                {/* Main layout: compact, scannable rows */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/incidents/${incident.id}`}
                      data-no-row-nav="true"
                      onClick={e => e.stopPropagation()}
                      className="font-bold text-sm md:text-base text-foreground leading-snug group-hover:text-primary transition-colors truncate block"
                    >
                      {incident.title}
                    </Link>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <StatusBadge status={incidentStatus} size="sm" showDot />
                      <PriorityBadge priority={incident.priority} size="sm" />
                      {buildUrgencyChip(incident.urgency)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-muted-foreground/80">
                        #{incident.id.slice(-5).toUpperCase()}
                      </span>

                      <span className="opacity-40">&middot;</span>

                      <span
                        className="cursor-help transition-colors hover:text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                        title={formatDateTime(new Date(incident.createdAt), userTimeZone, {
                          format: 'datetime',
                          includeTimeZone: true,
                        })}
                      >
                        {formatDistanceToNow(new Date(incident.createdAt), userTimeZone)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Section: Assignee + Triage buttons + Actions Menu */}
                <div className="flex items-center gap-2 shrink-0 pl-1">
                  {/* Assignee / Team / Unassigned */}
                  <div data-no-row-nav="true">
                    {incident.assignee ? (
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg">
                        <UserAvatar
                          userId={incident.assignee.id}
                          name={incident.assignee.name}
                          gender={incident.assignee.gender}
                          avatarUrl={incident.assignee.avatarUrl}
                          size="xs"
                          className="border-border/80"
                        />
                        <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                          {incident.assignee.name.split(' ')[0]}
                        </span>
                      </div>
                    ) : incident.team ? (
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg">
                        <div className="w-6 h-6 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-200/80 dark:border-indigo-800/60">
                          <UsersIcon className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                          {incident.team.name}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-muted-foreground px-2">
                        <UserIcon className="h-4 w-4" />
                        <span className="text-xs">Unassigned</span>
                      </div>
                    )}
                  </div>

                  {/* Quick triage actions */}
                  {incidentStatus === 'OPEN' && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-no-row-nav="true"
                      onClick={e => {
                        e.stopPropagation();
                        handleStatusChange(incident.id, 'ACKNOWLEDGED');
                      }}
                      disabled={isPending}
                      className="inline-flex h-7 px-2.5 text-xs font-semibold gap-1 border-blue-500/40 text-blue-700 hover:bg-blue-500/10 dark:text-blue-300 cursor-pointer shadow-2xs shrink-0"
                      title="Acknowledge Incident"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Ack</span>
                    </Button>
                  )}

                  {incidentStatus === 'ACKNOWLEDGED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-no-row-nav="true"
                      onClick={e => {
                        e.stopPropagation();
                        handleStatusChange(incident.id, 'RESOLVED');
                      }}
                      disabled={isPending}
                      className="inline-flex h-7 px-2.5 text-xs font-semibold gap-1 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300 cursor-pointer shadow-2xs shrink-0"
                      title="Resolve Incident"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Resolve</span>
                    </Button>
                  )}

                  {/* Actions Dropdown */}
                  <div data-no-row-nav="true" className="shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7.5 w-7.5 p-0 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
                          onClick={e => e.stopPropagation()}
                          aria-label="Incident actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/incidents/${incident.id}`}
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-2"
                          >
                            <Eye className="h-4 w-4 text-slate-500" />
                            View details
                          </Link>
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {incident.status !== 'RESOLVED' && (
                          <DropdownMenuItem
                            onSelect={() => handleStatusChange(incident.id, 'RESOLVED')}
                            className="flex items-center gap-2"
                          >
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            Resolve
                          </DropdownMenuItem>
                        )}

                        {incident.status !== 'ACKNOWLEDGED' && incident.status !== 'RESOLVED' && (
                          <DropdownMenuItem
                            onSelect={() => handleStatusChange(incident.id, 'ACKNOWLEDGED')}
                            className="flex items-center gap-2"
                          >
                            <CheckCircle2 className="h-4 w-4 text-amber-600" />
                            Acknowledge
                          </DropdownMenuItem>
                        )}

                        {incident.status === 'ACKNOWLEDGED' && (
                          <DropdownMenuItem
                            onSelect={() => handleStatusChange(incident.id, 'OPEN')}
                            className="flex items-center gap-2"
                          >
                            <Circle className="h-4 w-4 text-slate-500" />
                            Unacknowledge
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Memoize IncidentList to prevent unnecessary re-renders when parent updates
export default memo(IncidentList, (prevProps, nextProps) => {
  if (prevProps.serviceId !== nextProps.serviceId) return false;
  if (prevProps.incidents.length !== nextProps.incidents.length) return false;

  let index = 0;
  for (const inc of prevProps.incidents) {
    const nextInc = nextProps.incidents.at(index);
    index += 1;
    if (!inc || !nextInc) return false;
    if (inc.id !== nextInc.id) return false;
    if (inc.status !== nextInc.status) return false;
    if (inc.urgency !== nextInc.urgency) return false;
    if (inc.priority !== nextInc.priority) return false;
    if (inc.createdAt.getTime() !== nextInc.createdAt.getTime()) return false;
    if (inc.resolvedAt?.getTime() !== nextInc.resolvedAt?.getTime()) return false;
    if (inc.assignee?.id !== nextInc.assignee?.id) return false;
    if (inc.team?.id !== nextInc.team?.id) return false;
    if (inc.team?.name !== nextInc.team?.name) return false;
  }
  return true;
});
