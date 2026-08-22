'use client';

import { useState, useTransition, memo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { bulkAcknowledge, bulkResolve } from '@/app/(app)/incidents/bulk-actions';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import StatusBadge from '@/components/incident/StatusBadge';
import { useToast } from '@/components/ToastProvider';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Check, MoreHorizontal, ArrowUp, ArrowDown, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

type Incident = {
  id: string;
  title: string;
  status: string;
  urgency?: string;
  service: { name: string };
  assignee: { id?: string; name: string; avatarUrl?: string | null; gender?: string | null } | null;
  team?: { name: string } | null;
  createdAt: Date;
};

type IncidentTableProps = {
  incidents: Incident[];
  sortBy?: string;
  sortOrder?: string;
};

export default memo(function IncidentTable({
  incidents,
  sortBy = 'createdAt',
  sortOrder = 'desc',
}: IncidentTableProps) {
  const { userTimeZone } = useTimezone();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { showToast } = useToast();

  // Handle sort click
  const handleSortClick = (newSortBy: string) => {
    const params = new URLSearchParams(searchParams.toString());

    // Always reset page when sorting
    params.delete('page');

    if (sortBy === newSortBy && sortOrder === 'asc') {
      // If already sorted by this field ascending, switch to descending
      params.set('sortBy', newSortBy);
      params.set('sortOrder', 'desc');
    } else if (sortBy === newSortBy && sortOrder === 'desc') {
      // If already sorted by this field descending, remove sort (go to default)
      params.delete('sortBy');
      params.delete('sortOrder');
    } else {
      // New field, sort ascending
      params.set('sortBy', newSortBy);
      params.set('sortOrder', 'asc');
    }

    const queryString = params.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname || '/';
    router.push(newUrl, { scroll: false });
  };

  const renderSortArrow = () => (sortOrder === 'asc' ? '↑' : '↓');

  const buildUrgencyChip = (urgency: string | null | undefined) => {
    if (!urgency) return null;
    const u = urgency.toUpperCase();
    const variant = u === 'HIGH' ? 'danger' : u === 'MEDIUM' ? 'warning' : 'success';

    return (
      <Badge
        variant={variant}
        size="xs"
        className="font-extrabold uppercase"
        title={`Urgency: ${u}`}
      >
        {u}
      </Badge>
    );
  };

  const getStatusAccent = (status: string) => {
    switch (status) {
      case 'OPEN':
        return { accent: 'rgba(239, 68, 68, 0.7)', glow: 'rgba(239, 68, 68, 0.10)' };
      case 'ACKNOWLEDGED':
        return { accent: 'rgba(245, 158, 11, 0.7)', glow: 'rgba(245, 158, 11, 0.10)' };
      case 'RESOLVED':
        return { accent: 'rgba(34, 197, 94, 0.7)', glow: 'rgba(34, 197, 94, 0.10)' };
      default:
        return { accent: 'rgba(148, 163, 184, 0.9)', glow: 'rgba(148, 163, 184, 0.08)' };
    }
  };

  const closeDetailsMenu = (el: HTMLElement) => {
    const details = el.closest('details') as HTMLDetailsElement | null;
    if (details) details.open = false;
  };

  const toggleIncident = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleAll = () => {
    if (selectedIds.size === incidents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(incidents.map(i => i.id)));
    }
  };

  const handleBulkAcknowledge = () => {
    startTransition(async () => {
      try {
        const result = await bulkAcknowledge(Array.from(selectedIds));
        if (result.success) {
          showToast(`${result.count} incident(s) acknowledged`, 'success');
          setSelectedIds(new Set());
          router.refresh();
        } else {
          showToast(result.error || 'Failed to acknowledge incidents', 'error');
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to acknowledge incidents', 'error');
      }
    });
  };

  const handleBulkResolve = () => {
    startTransition(async () => {
      try {
        const result = await bulkResolve(Array.from(selectedIds));
        if (result.success) {
          showToast(`${result.count} incident(s) resolved`, 'success');
          setSelectedIds(new Set());
          router.refresh();
        } else {
          showToast(result.error || 'Failed to resolve incidents', 'error');
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to resolve incidents', 'error');
      }
    });
  };

  const handleStatusChange = async (
    incidentId: string,
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED'
  ) => {
    startTransition(async () => {
      try {
        await updateIncidentStatus(incidentId, status);
        showToast(`Incident ${status.toLowerCase()} successfully`, 'success');
        router.refresh();
      } catch (error) {
        const { getUserFriendlyError } = await import('@/lib/user-friendly-errors');
        showToast(getUserFriendlyError(error) || 'Failed to update status', 'error');
      }
    });
  };

  return (
    <div className="relative">
      <style>{`
        details.dashboard-incident-menu > summary::-webkit-details-marker { display: none; }
        details.dashboard-incident-menu > summary { list-style: none; }
      `}</style>
      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-primary/90 to-primary text-white flex justify-between items-center gap-3 flex-wrap border-b border-white/10">
          <span className="font-bold text-sm">{selectedIds.size} selected</span>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={handleBulkAcknowledge}
              disabled={isPending}
              variant="outline"
              size="sm"
              className="bg-white/20 border-white/30 text-white hover:bg-white/30 disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Acknowledge
            </Button>
            <Button
              onClick={handleBulkResolve}
              disabled={isPending}
              size="sm"
              className="bg-white text-primary hover:bg-white/90 disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Resolve
            </Button>
          </div>
        </div>
      )}

      {/* Sort toolbar */}
      <div className="px-4 py-3 border-b bg-card flex justify-between items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-bold">Sort:</span>
          {[
            { key: 'createdAt', label: 'Created' },
            { key: 'status', label: 'Status' },
            { key: 'urgency', label: 'Urgency' },
            { key: 'title', label: 'Title' },
          ].map(opt => {
            const active = sortBy === opt.key;
            return (
              <Button
                key={opt.key}
                onClick={() => handleSortClick(opt.key)}
                variant={active ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-7 px-2.5 text-xs font-bold rounded-full gap-1.5',
                  active && 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
                )}
              >
                {opt.label}
                {active &&
                  (sortOrder === 'asc' ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  ))}
              </Button>
            );
          })}
        </div>

        <div className="flex gap-2 items-center">
          <Button
            type="button"
            onClick={toggleAll}
            variant="outline"
            size="sm"
            disabled={incidents.length === 0}
          >
            {selectedIds.size === incidents.length && incidents.length > 0
              ? 'Clear selection'
              : 'Select page'}
          </Button>
        </div>
      </div>

      {/* Card list */}
      <div className="p-3.5 px-4 bg-card">
        {incidents.length === 0 ? (
          <div className="py-9 px-6 text-center text-muted-foreground border border-dashed border-border rounded-lg bg-gradient-to-br from-neutral-50 to-white">
            <FileText className="h-9 w-9 mx-auto mb-3 opacity-30" />
            <div className="text-base font-bold text-secondary-foreground mb-1">
              No incidents found
            </div>
            <div className="text-sm">
              No incidents match your current filters. Try adjusting your search criteria.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {incidents.map(incident => {
              const isSelected = selectedIds.has(incident.id);
              const accent = getStatusAccent(incident.status);
              const urgencyChip = buildUrgencyChip(incident.urgency);

              return (
                <div
                  key={incident.id}
                  className={cn(
                    'border rounded-xl overflow-hidden cursor-pointer transition-all duration-150',
                    isSelected
                      ? 'border-primary/35 bg-primary/5 shadow-[0_12px_26px_rgba(15,23,42,0.10)]'
                      : 'border-border bg-white shadow-xs hover:shadow-sm hover:-translate-y-px'
                  )}
                  style={
                    isSelected
                      ? {
                          boxShadow: `0 12px 26px rgba(15, 23, 42, 0.10), 0 0 0 4px ${accent.glow}`,
                        }
                      : undefined
                  }
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
                  <div
                    className="flex gap-3.5 p-3.5 px-4 items-start"
                    style={{ borderLeft: `4px solid ${accent.accent}` }}
                  >
                    <div data-no-row-nav="true" className="pt-0.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleIncident(incident.id)}
                        className="cursor-pointer w-[18px] h-[18px]"
                        aria-label={`Select incident ${incident.title}`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-3 flex-wrap">
                        <div className="min-w-0">
                          <Link
                            href={`/incidents/${incident.id}`}
                            data-no-row-nav="true"
                            onClick={e => e.stopPropagation()}
                            className="block font-extrabold text-foreground no-underline text-[0.95rem] leading-tight overflow-hidden overflow-ellipsis whitespace-nowrap"
                          >
                            {incident.title}
                          </Link>

                          <div className="flex gap-2.5 items-center mt-1.5 flex-wrap">
                            <span className="text-xs text-muted-foreground font-semibold">
                              #{incident.id.slice(-5).toUpperCase()}
                            </span>
                            <span className="text-muted-foreground text-xs">•</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(incident.createdAt, userTimeZone, {
                                format: 'short',
                              })}
                            </span>
                            <span className="text-muted-foreground text-xs">•</span>
                            <span
                              className="text-xs text-secondary-foreground font-semibold overflow-hidden overflow-ellipsis whitespace-nowrap max-w-[360px]"
                              title={incident.service.name}
                            >
                              {incident.service.name}
                            </span>
                          </div>
                        </div>

                        <div
                          data-no-row-nav="true"
                          className="flex items-center gap-2 flex-wrap justify-end"
                        >
                          <Button
                            size="sm"
                            asChild
                            className="h-8 px-3 text-xs font-extrabold shadow-xs whitespace-nowrap"
                          >
                            <Link
                              href={`/incidents/${incident.id}`}
                              onClick={e => e.stopPropagation()}
                            >
                              Open
                            </Link>
                          </Button>

                          <details
                            className="dashboard-incident-menu relative"
                            onClick={e => e.stopPropagation()}
                          >
                            <summary
                              aria-label="More actions"
                              className="cursor-pointer py-1.5 px-2.5 rounded-lg border border-border bg-white text-secondary-foreground text-sm leading-none select-none shadow-xs"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </summary>
                            <div className="absolute right-0 top-[calc(100%+8px)] min-w-[220px] bg-white border border-border rounded-lg shadow-lg p-1.5 z-50">
                              <Link
                                href={`/incidents/${incident.id}`}
                                onClick={e => {
                                  e.stopPropagation();
                                  closeDetailsMenu(e.currentTarget as unknown as HTMLElement);
                                }}
                                className="flex items-center gap-2 py-2 px-2.5 rounded-lg no-underline text-foreground font-semibold text-sm hover:bg-neutral-50 transition-colors"
                              >
                                View details →
                              </Link>

                              <div className="h-px bg-border my-1 mx-1.5" />

                              {incident.status !== 'RESOLVED' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={e => {
                                    e.stopPropagation();
                                    closeDetailsMenu(e.currentTarget);
                                    handleStatusChange(incident.id, 'RESOLVED');
                                  }}
                                  className="w-full justify-start text-sm font-bold text-primary hover:bg-primary/10"
                                >
                                  <Check className="h-3.5 w-3.5 mr-2" />
                                  Resolve
                                </Button>
                              )}

                              {incident.status !== 'ACKNOWLEDGED' &&
                                incident.status !== 'RESOLVED' && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={isPending}
                                    onClick={e => {
                                      e.stopPropagation();
                                      closeDetailsMenu(e.currentTarget);
                                      handleStatusChange(incident.id, 'ACKNOWLEDGED');
                                    }}
                                    className="w-full justify-start text-sm font-semibold hover:bg-neutral-50"
                                  >
                                    <Check className="h-3.5 w-3.5 mr-2" />
                                    Acknowledge
                                  </Button>
                                )}

                              {incident.status === 'ACKNOWLEDGED' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={e => {
                                    e.stopPropagation();
                                    closeDetailsMenu(e.currentTarget);
                                    handleStatusChange(incident.id, 'OPEN');
                                  }}
                                  className="w-full justify-start text-sm font-semibold hover:bg-neutral-50"
                                >
                                  ↩ Unacknowledge
                                </Button>
                              )}

                              {incident.status === 'RESOLVED' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  asChild
                                  className="w-full justify-start text-sm font-bold text-primary hover:bg-primary/10"
                                >
                                  <Link
                                    href={`/postmortems/${incident.id}`}
                                    onClick={e => {
                                      e.stopPropagation();
                                      closeDetailsMenu(e.currentTarget as unknown as HTMLElement);
                                    }}
                                  >
                                    View postmortem →
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </details>
                        </div>
                      </div>

                      <div className="mt-2.5 flex gap-1.5 flex-wrap items-center">
                        <StatusBadge status={incident.status as any} size="sm" showDot />
                        {urgencyChip}
                        <span className="text-muted-foreground text-xs">•</span>
                        {incident.assignee ? (
                          <div className="flex items-center gap-1.5">
                            <DirectUserAvatar
                              avatarUrl={
                                incident.assignee.avatarUrl ||
                                getDefaultAvatar(
                                  incident.assignee.gender,
                                  incident.assignee.id || incident.assignee.name
                                )
                              }
                              name={incident.assignee.name}
                              size="xs"
                            />
                            <span className="text-secondary-foreground text-sm font-semibold">
                              {incident.assignee.name}
                            </span>
                          </div>
                        ) : incident.team ? (
                          <span className="text-secondary-foreground text-sm font-semibold">
                            {incident.team.name}
                          </span>
                        ) : (
                          <span className="text-secondary-foreground text-sm font-semibold">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
