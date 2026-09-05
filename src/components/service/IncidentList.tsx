'use client';

import { memo, useTransition } from 'react';
import { IncidentStatus } from '@prisma/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import StatusBadge from '../incident/StatusBadge';
import PriorityBadge from '@/components/incident/PriorityBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { Clock, CheckCircle2, Users as UsersIcon, MoreHorizontal, Eye, Circle } from 'lucide-react';
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

function getStatusAccentClass(status: IncidentStatus): string {
  switch (status) {
    case 'OPEN':
      return 'border-l-rose-500';
    case 'ACKNOWLEDGED':
      return 'border-l-amber-500';
    case 'RESOLVED':
      return 'border-l-emerald-500';
    case 'SNOOZED':
    case 'SUPPRESSED':
    default:
      return 'border-l-muted-foreground';
  }
}

// Urgency Badge Component
function UrgencyBadge({ urgency }: { urgency: string }) {
  const normalized = urgency?.toUpperCase();
  if (normalized === 'HIGH') {
    return (
      <Badge
        variant="danger"
        size="xs"
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
      >
        High
      </Badge>
    );
  }
  if (normalized === 'MEDIUM') {
    return (
      <Badge
        variant="warning"
        size="xs"
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
      >
        Med
      </Badge>
    );
  }
  return (
    <Badge
      variant="neutral"
      size="xs"
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
    >
      Low
    </Badge>
  );
}

function IncidentList({ incidents, serviceId }: IncidentListProps) {
  const { userTimeZone } = useTimezone();
  const router = useRouter();
  const [_isPending, startTransition] = useTransition();
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
        <h3 className="text-sm font-semibold text-foreground mb-1">No incidents recorded</h3>
        <p className="text-xs text-muted-foreground max-w-sm mb-6">
          This service is running smoothly with no recorded incidents.
        </p>
        <CreateIncidentButton serviceId={serviceId} />
      </div>
    );
  }

  return (
    <div className="p-3 md:p-4 bg-transparent">
      <div className="flex flex-col gap-2.5">
        {incidents.map(incident => {
          const incidentStatus = incident.status;

          return (
            <div
              key={incident.id}
              className={cn(
                'group relative rounded-lg border bg-card text-card-foreground shadow-2xs transition-all',
                'hover:shadow-sm hover:-translate-y-[0.5px]',
                'border-border',
                getStatusAccentClass(incidentStatus),
                'border-l-[3px]'
              )}
            >
              <Link
                href={`/incidents/${incident.id}`}
                className="absolute inset-0 z-0"
                aria-label={`View incident ${incident.title}`}
              />

              <div className="relative z-10 p-2.5 sm:p-3 flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {/* Header Row: Title & Badges */}
                  <div className="flex flex-wrap items-start justify-between gap-y-1.5 gap-x-3">
                    <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug group-hover:text-primary transition-colors pr-2 min-w-0">
                      {incident.title}
                    </h3>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusBadge status={incidentStatus} size="sm" showDot />
                      <PriorityBadge priority={incident.priority} size="sm" />
                      <UrgencyBadge urgency={incident.urgency} />
                    </div>
                  </div>

                  {/* Meta Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-2 text-[11px] sm:text-xs text-muted-foreground font-medium">
                      <span className="font-mono text-muted-foreground/70 text-[10px] sm:text-[11px]">
                        #{incident.id.slice(-5).toUpperCase()}
                      </span>
                      <span className="opacity-40">&middot;</span>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 opacity-70" />
                        <span>
                          {formatDistanceToNow(new Date(incident.createdAt), userTimeZone)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Assignee */}
                      {incident.assignee ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/40 border border-border/70 text-[11px] text-foreground font-medium">
                          <Avatar className="h-3.5 w-3.5">
                            <AvatarImage
                              src={
                                incident.assignee.avatarUrl ||
                                getDefaultAvatar(
                                  incident.assignee.gender,
                                  incident.assignee.id || incident.assignee.name
                                )
                              }
                            />
                            <AvatarFallback className="text-[8px]">
                              {incident.assignee.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-[100px] truncate">{incident.assignee.name}</span>
                        </div>
                      ) : incident.team ? (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/50 dark:border-indigo-800/40 text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                          <div className="h-3.5 w-3.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                            <UsersIcon className="h-2 w-2" />
                          </div>
                          <span className="max-w-[100px] truncate">{incident.team.name}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/60 italic px-1">
                          Unassigned
                        </span>
                      )}

                      {/* Actions Menu */}
                      <div className="relative z-20">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 rounded-full hover:bg-muted -mr-1 focus:ring-1 focus:ring-ring"
                              onClick={e => {
                                e.stopPropagation(); // Stop link navigation
                              }}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/incidents/${incident.id}`}
                                className="flex items-center gap-2"
                              >
                                <Eye className="h-4 w-4 text-muted-foreground" />
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

                            {incident.status !== 'ACKNOWLEDGED' &&
                              incident.status !== 'RESOLVED' && (
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
                                <Circle className="h-4 w-4 text-muted-foreground" />
                                Unacknowledge
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
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
