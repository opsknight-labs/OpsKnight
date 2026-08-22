'use client';

import { memo, useTransition } from 'react';
import { IncidentStatus } from '@prisma/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import StatusBadge from '../incident/StatusBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import {
  AlertCircle,
  Clock,
  CheckCircle2,
  User as UserIcon,
  Users as UsersIcon,
  Search,
  ArrowRight,
  MoreHorizontal,
  Eye,
  Circle,
  PauseCircle,
  ShieldOff,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { useToast } from '@/components/ToastProvider';

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

const statusAccentClass: Record<string, string> = {
  OPEN: 'border-l-red-500',
  ACKNOWLEDGED: 'border-l-amber-500',
  RESOLVED: 'border-l-emerald-500',
  SNOOZED: 'border-l-slate-400',
  SUPPRESSED: 'border-l-slate-400',
};

// Urgency Badge Component
function UrgencyBadge({ urgency }: { urgency: string }) {
  if (urgency === 'HIGH') {
    return (
      <Badge variant="danger" size="xs" className="uppercase">
        High
      </Badge>
    );
  }
  if (urgency === 'MEDIUM') {
    return (
      <Badge variant="warning" size="xs" className="uppercase">
        Med
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" size="xs" className="uppercase">
      Low
    </Badge>
  );
}

// Priority Badge Component
function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;

  const colors = {
    P1: 'danger',
    P2: 'warning',
    P3: 'warning',
    P4: 'info',
  };

  const badgeVariant = (colors[priority as keyof typeof colors] || 'neutral') as any;

  return (
    <Badge variant={badgeVariant} size="xs" className="tracking-tight">
      {priority}
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
      } catch (error) {
        showToast('Failed to update status', 'error');
      }
    });
  };

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white">
        <div className="bg-slate-50 p-4 rounded-full mb-4 ring-1 ring-slate-100">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">No incidents recorded</h3>
        <p className="text-slate-500 max-w-sm mb-6">
          This service is running smoothly with no recorded incidents.
        </p>
        <Button asChild>
          <Link href={`/incidents/create?serviceId=${serviceId}`}>Create Incident</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-4 bg-white">
      <div className="flex flex-col gap-3">
        {incidents.map(incident => {
          const incidentStatus = incident.status;

          return (
            <div
              key={incident.id}
              className={cn(
                'group relative rounded-xl border bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-all',
                'hover:shadow-md hover:-translate-y-[1px]',
                'border-slate-200',
                statusAccentClass[incidentStatus] ?? 'border-l-slate-300',
                'border-l-4'
              )}
            >
              <Link
                href={`/incidents/${incident.id}`}
                className="absolute inset-0 z-0"
                aria-label={`View incident ${incident.title}`}
              />

              <div className="relative z-10 p-3 md:p-3.5 flex items-start gap-3 md:gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Header Row: Title & Badges */}
                  <div className="flex flex-wrap items-start justify-between gap-y-2 gap-x-4">
                    <h3 className="text-sm font-extrabold text-slate-900 leading-tight group-hover:text-primary transition-colors pr-2">
                      {incident.title}
                    </h3>

                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={incidentStatus} size="sm" showDot />
                      <PriorityBadge priority={incident.priority} />
                      <UrgencyBadge urgency={incident.urgency} />
                    </div>
                  </div>

                  {/* Meta Row */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                      <span className="font-mono text-slate-400">
                        #{incident.id.slice(-5).toUpperCase()}
                      </span>
                      <span className="opacity-30">&middot;</span>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 opacity-70" />
                        {formatDistanceToNow(new Date(incident.createdAt), userTimeZone)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Assignee */}
                      {incident.assignee ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-100">
                          <Avatar className="h-4 w-4">
                            <AvatarImage
                              src={
                                incident.assignee.avatarUrl ||
                                getDefaultAvatar(
                                  incident.assignee.gender,
                                  incident.assignee.id || incident.assignee.name
                                )
                              }
                            />
                            <AvatarFallback className="text-[9px]">
                              {incident.assignee.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs text-slate-700 font-medium max-w-[100px] truncate">
                            {incident.assignee.name}
                          </span>
                        </div>
                      ) : incident.team ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-indigo-50 border border-indigo-100">
                          <div className="h-4 w-4 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                            <UsersIcon className="h-2.5 w-2.5" />
                          </div>
                          <span className="text-xs text-indigo-700 font-medium max-w-[100px] truncate">
                            {incident.team.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic px-2">Unassigned</span>
                      )}

                      {/* Actions Menu */}
                      <div className="relative z-20">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-full hover:bg-slate-100 -mr-2 focus:ring-1 focus:ring-slate-300"
                              onClick={e => {
                                e.stopPropagation(); // Stop link navigation
                              }}
                            >
                              <MoreHorizontal className="h-4 w-4 text-slate-400" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/incidents/${incident.id}`}
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
  // Custom comparison: only re-render if incidents or serviceId changed
  return (
    prevProps.serviceId === nextProps.serviceId &&
    prevProps.incidents.length === nextProps.incidents.length &&
    prevProps.incidents.every(
      (inc, i) =>
        inc.id === nextProps.incidents[i]?.id &&
        inc.status === nextProps.incidents[i]?.status &&
        inc.urgency === nextProps.incidents[i]?.urgency &&
        inc.priority === nextProps.incidents[i]?.priority &&
        inc.createdAt.getTime() === nextProps.incidents[i]?.createdAt.getTime() &&
        inc.resolvedAt?.getTime() === nextProps.incidents[i]?.resolvedAt?.getTime() &&
        inc.assignee?.id === nextProps.incidents[i]?.assignee?.id &&
        inc.team?.id === nextProps.incidents[i]?.team?.id &&
        inc.team?.name === nextProps.incidents[i]?.team?.name
    )
  );
});
