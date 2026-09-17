'use client';

import { memo, useState, useTransition } from 'react';
import { IncidentStatus } from '@prisma/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import StatusBadge from '../incident/StatusBadge';
import PriorityBadge from '@/components/incident/PriorityBadge';
import EscalationStatusBadge from '@/components/incident/EscalationStatusBadge';
import ResolveIncidentModal, {
  type ResolvingIncidentData,
} from '@/components/incident/ResolveIncidentModal';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import {
  Clock,
  CheckCircle2,
  Users as UsersIcon,
  MoreHorizontal,
  Eye,
  Circle,
  Loader2,
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
  acknowledgedAt?: Date | null;
  escalationStatus?: string | null;
  currentEscalationStep?: number | null;
  nextEscalationAt?: Date | null;
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
  serviceName?: string;
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

// Urgency Badge Component matching canonical incident page
function UrgencyBadge({ urgency }: { urgency: string }) {
  if (!urgency) return null;
  const normalized = urgency.toUpperCase();
  const variant =
    normalized === 'HIGH' ? 'danger' : normalized === 'MEDIUM' ? 'warning' : 'neutral';
  return (
    <Badge
      variant={variant}
      size="xs"
      className="uppercase font-semibold tracking-wider text-[10px]"
      title={`Urgency: ${normalized}`}
    >
      {normalized === 'HIGH' ? 'High' : normalized === 'MEDIUM' ? 'Med' : 'Low'}
    </Badge>
  );
}

function IncidentList({ incidents, serviceId, serviceName }: IncidentListProps) {
  const { userTimeZone } = useTimezone();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const [resolvingIncident, setResolvingIncident] = useState<ResolvingIncidentData | null>(null);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  const handleStatusChange = (incidentId: string, newStatus: IncidentStatus) => {
    if (newStatus === 'RESOLVED') {
      const inc = incidents.find(i => i.id === incidentId);
      if (inc) {
        setResolvingIncident({
          id: inc.id,
          title: inc.title,
          service: serviceName ? { name: serviceName } : null,
        });
      }
      return;
    }

    startTransition(async () => {
      try {
        await updateIncidentStatus(incidentId, newStatus);
        showToast(`Incident ${newStatus.toLowerCase()} successfully`, 'success');
        router.refresh();
      } catch (error) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        showToast(getUserFacingErrorMessage(error) || 'Failed to update status', 'error');
      }
    });
  };

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-2xl border border-border bg-card text-card-foreground shadow-2xs">
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
    <>
      <div className="flex flex-col gap-3">
        {incidents.map(incident => {
          const incidentStatus = incident.status;

          return (
            <div
              key={incident.id}
              aria-label={`Incident: ${incident.title}`}
              className={cn(
                'group relative rounded-2xl border bg-card text-card-foreground transition-all duration-150 overflow-hidden',
                'hover:shadow-md hover:-translate-y-[1px]',
                'focus-within:ring-2 focus-within:ring-primary/20',
                'border-border',
                getStatusHoverBorder(incidentStatus),
                navigatingId === incident.id && 'opacity-70 pointer-events-none'
              )}
              onClick={e => {
                const target = e.target as HTMLElement;
                if (target.closest('[data-no-row-nav="true"]')) return;
                setNavigatingId(incident.id);
                startTransition(() => {
                  router.push(`/incidents/${incident.id}`);
                });
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setNavigatingId(incident.id);
                  startTransition(() => {
                    router.push(`/incidents/${incident.id}`);
                  });
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

              {/* Loading overlay */}
              {navigatingId === incident.id && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/70 backdrop-blur-[1px] rounded-2xl">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full border border-primary/20 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm font-medium text-primary">Opening...</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 pl-4 pr-3.5 py-3.5 md:py-4">
                {/* Main incident info */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/incidents/${incident.id}`}
                      data-no-row-nav="true"
                      onClick={e => e.stopPropagation()}
                      className="font-bold text-sm md:text-base text-foreground leading-snug group-hover:text-primary transition-colors truncate block max-w-full"
                    >
                      {incident.title}
                    </Link>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <StatusBadge status={incidentStatus} size="sm" showDot />
                      <PriorityBadge priority={incident.priority} size="sm" />
                      <UrgencyBadge urgency={incident.urgency} />
                      {incident.escalationStatus && (
                        <EscalationStatusBadge
                          status={incident.escalationStatus}
                          currentStep={incident.currentEscalationStep}
                          nextEscalationAt={incident.nextEscalationAt}
                          size="sm"
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-muted-foreground/80">
                        #{incident.id.slice(-5).toUpperCase()}
                      </span>

                      <span className="opacity-40">&middot;</span>

                      <span
                        className="cursor-help transition-colors hover:text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 flex items-center gap-1.5"
                        title={formatDateTime(incident.createdAt, userTimeZone, {
                          format: 'datetime',
                          includeTimeZone: true,
                        })}
                      >
                        <Clock className="h-3 w-3 opacity-70" />
                        <span>
                          {formatDistanceToNow(new Date(incident.createdAt), userTimeZone)}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right-hand side controls */}
                <div
                  className="flex items-center gap-2 shrink-0 sm:self-center"
                  data-no-row-nav="true"
                >
                  {/* Assignee / Team / Unassigned */}
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

                  {/* Quick Triage Actions */}
                  {incidentStatus === 'OPEN' && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-no-row-nav="true"
                      data-testid="quick-ack-btn"
                      aria-label={`Acknowledge incident ${incident.title}`}
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
                      data-testid="quick-resolve-btn"
                      aria-label={`Resolve incident ${incident.title}`}
                      onClick={e => {
                        e.stopPropagation();
                        setResolvingIncident({
                          id: incident.id,
                          title: incident.title,
                          service: serviceName ? { name: serviceName } : null,
                        });
                      }}
                      disabled={isPending}
                      className="inline-flex h-7 px-2.5 text-xs font-semibold gap-1 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300 cursor-pointer shadow-2xs shrink-0"
                      title="Resolve Incident"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Resolve</span>
                    </Button>
                  )}

                  {/* Dropdown Menu */}
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
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <Eye className="h-4 w-4 text-slate-500" />
                            View details
                          </Link>
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {incident.status !== 'RESOLVED' && (
                          <DropdownMenuItem
                            onSelect={e => {
                              e.preventDefault();
                              setResolvingIncident({
                                id: incident.id,
                                title: incident.title,
                                service: serviceName ? { name: serviceName } : null,
                              });
                            }}
                            className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium cursor-pointer"
                          >
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            Resolve
                          </DropdownMenuItem>
                        )}

                        {incident.status !== 'ACKNOWLEDGED' && incident.status !== 'RESOLVED' && (
                          <DropdownMenuItem
                            onSelect={() => handleStatusChange(incident.id, 'ACKNOWLEDGED')}
                            className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium cursor-pointer"
                          >
                            <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            Acknowledge
                          </DropdownMenuItem>
                        )}

                        {incident.status === 'ACKNOWLEDGED' && (
                          <DropdownMenuItem
                            onSelect={() => handleStatusChange(incident.id, 'OPEN')}
                            className="flex items-center gap-2 cursor-pointer"
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
          );
        })}
      </div>

      {/* Centralized Resolve Incident Modal */}
      <ResolveIncidentModal
        incident={resolvingIncident}
        open={!!resolvingIncident}
        onOpenChange={open => {
          if (!open) setResolvingIncident(null);
        }}
      />
    </>
  );
}

// Memoize IncidentList to prevent unnecessary re-renders when parent updates
export default memo(IncidentList, (prevProps, nextProps) => {
  if (prevProps.serviceId !== nextProps.serviceId) return false;
  if (prevProps.serviceName !== nextProps.serviceName) return false;
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
    if (inc.escalationStatus !== nextInc.escalationStatus) return false;
    if (inc.currentEscalationStep !== nextInc.currentEscalationStep) return false;
  }
  return true;
});
