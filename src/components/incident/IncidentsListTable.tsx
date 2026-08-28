'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Button } from '@/components/ui/shadcn/button';
import type { IncidentListItem } from '@/types/incident-list';
import { updateIncidentStatus } from '@/app/(app)/incidents/actions';
import {
  bulkAcknowledge,
  bulkResolve,
  bulkReassign,
  bulkUpdatePriority,
  bulkSnooze,
  bulkUnsnooze,
  bulkSuppress,
  bulkUnsuppress,
  bulkUpdateUrgency,
  bulkUpdateStatus,
} from '@/app/(app)/incidents/bulk-actions';
import { useToast } from '@/hooks/use-product-notification';
import Pagination from './Pagination';

import StatusBadge from './StatusBadge';
import EscalationStatusBadge from './EscalationStatusBadge';
import PriorityBadge from './PriorityBadge';
import AssigneeSection from './AssigneeSection';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  CheckCircle2,
  MoreHorizontal,
  PauseCircle,
  ShieldOff,
  ShieldCheck,
  Eye,
  Circle,
  Download,
  CheckSquare,
  XCircle,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';

type IncidentsListTableProps = {
  incidents: IncidentListItem[];
  users: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
    role?: string;
  }>;
  canManageIncidents: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  title?: string;
  showExport?: boolean;
};

type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
type BulkActionMode = 'reassign' | 'priority' | 'snooze' | 'urgency' | 'status' | null;

const statusAccentClass: Record<IncidentStatus, string> = {
  OPEN: 'border-l-red-500',
  ACKNOWLEDGED: 'border-l-amber-500',
  RESOLVED: 'border-l-emerald-500',
  SNOOZED: 'border-l-slate-400',
  SUPPRESSED: 'border-l-slate-400',
};

export default function IncidentsListTable({
  incidents,
  users,
  canManageIncidents,
  pagination,
  title,
  showExport = true,
}: IncidentsListTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { userTimeZone } = useTimezone();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkActionMode>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  const totalItems = pagination?.totalItems ?? incidents.length;
  const showingFrom =
    pagination && totalItems > 0
      ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1
      : totalItems > 0
        ? 1
        : 0;
  const showingTo = pagination
    ? Math.min(pagination.currentPage * pagination.itemsPerPage, totalItems)
    : Math.min(incidents.length, totalItems);

  const selectedCount = selectedIds.size;

  const selectedMeta = useMemo(() => {
    const ids = Array.from(selectedIds);
    let hasSnoozed = false;
    let hasSuppressed = false;
    for (const id of ids) {
      const inc = incidents.find(i => i.id === id);
      if (!inc) continue;
      if (inc.status === 'SNOOZED') hasSnoozed = true;
      if (inc.status === 'SUPPRESSED') hasSuppressed = true;
      if (hasSnoozed && hasSuppressed) break;
    }
    return { hasSnoozed, hasSuppressed };
  }, [selectedIds, incidents]);

  const handleStatusChange = async (incidentId: string, status: IncidentStatus) => {
    startTransition(async () => {
      try {
        await updateIncidentStatus(incidentId, status);
        showToast(`Incident ${status.toLowerCase()} successfully`, 'success');
        router.refresh();
      } catch (error) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        showToast(getUserFacingErrorMessage(error) || 'Failed to update status', 'error');
      }
    });
  };

  const toggleSelectAllOnPage = () => {
    if (selectedIds.size === incidents.length) {
      setSelectedIds(new Set());
      setLastSelectedIndex(null);
      return;
    }
    setSelectedIds(new Set(incidents.map(i => i.id)));
    setLastSelectedIndex(incidents.length - 1);
  };

  const toggleSelectWithRange = (id: string, index: number, shiftKey: boolean) => {
    const next = new Set(selectedIds);

    // If shift pressed and we have a prior index, select a range
    if (shiftKey && lastSelectedIndex !== null) {
      const [from, to] =
        index > lastSelectedIndex ? [lastSelectedIndex, index] : [index, lastSelectedIndex];
      const rangeIds = incidents.slice(from, to + 1).map(i => i.id);

      // If the clicked one is already selected, interpret as "remove range", else "add range"
      const shouldRemove = next.has(id);
      for (const rid of rangeIds) {
        if (shouldRemove) next.delete(rid);
        else next.add(rid);
      }
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }

    setSelectedIds(next);
    setLastSelectedIndex(index);
  };

  const handleBulkAction = async (
    action:
      | 'acknowledge'
      | 'resolve'
      | 'reassign'
      | 'priority'
      | 'snooze'
      | 'unsnooze'
      | 'suppress'
      | 'unsuppress'
      | 'urgency'
      | 'status',
    value?: string | number
  ) => {
    if (selectedIds.size === 0) {
      showToast('Please select incidents first', 'error');
      return;
    }

    startTransition(async () => {
      try {
        let result: { success: boolean; count?: number; error?: string } | undefined;

        const ids = Array.from(selectedIds);

        if (action === 'acknowledge') result = await bulkAcknowledge(ids);
        else if (action === 'resolve') result = await bulkResolve(ids);
        else if (action === 'reassign' && value) result = await bulkReassign(ids, value as string);
        else if (action === 'priority')
          result = await bulkUpdatePriority(ids, (value ?? '') as string);
        else if (action === 'snooze' && typeof value === 'number')
          result = await bulkSnooze(ids, value, null);
        else if (action === 'unsnooze') result = await bulkUnsnooze(ids);
        else if (action === 'suppress') result = await bulkSuppress(ids);
        else if (action === 'unsuppress') result = await bulkUnsuppress(ids);
        else if (action === 'urgency' && value)
          result = await bulkUpdateUrgency(ids, value as 'HIGH' | 'MEDIUM' | 'LOW');
        else if (action === 'status' && value)
          result = await bulkUpdateStatus(ids, value as IncidentStatus);
        else return;

        if (result?.success) {
          showToast(`${result.count} incident(s) updated successfully`, 'success');
          setSelectedIds(new Set());
          setBulkAction(null);
          setLastSelectedIndex(null);
          router.refresh();
        } else {
          showToast(result?.error || 'Failed to update incidents', 'error');
        }
      } catch (error) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        showToast(getUserFacingErrorMessage(error) || 'Failed to update incidents', 'error');
      }
    });
  };

  const handleExport = async (format: 'csv' | 'xlsx' = 'csv') => {
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      // Exclude page parameter - export should export all matching incidents
      if (key !== 'page') params.append(key, value);
    });
    params.set('format', format);

    try {
      const response = await fetch(`/api/incidents/export?${params.toString()}`);
      if (!response.ok) {
        showToast('Failed to export incidents', 'error');
        return;
      }

      if (response.redirected && response.url.includes('/login')) {
        showToast('Export failed: session expired. Please sign in again.', 'error');
        return;
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('text/html')) {
        showToast('Export failed: unauthorized response', 'error');
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";\n]+)"?/i);
      const filename =
        match?.[1]?.trim() || `incidents-${new Date().toISOString().split('T')[0]}.${format}`;

      // Create a blob URL and trigger download using anchor element
      // This approach works more reliably across all browsers, especially Chrome
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
      showToast(getUserFacingErrorMessage(error) || 'Failed to export incidents', 'error');
    }
  };

  const buildUrgencyChip = (urgency: string | null | undefined) => {
    if (!urgency) return null;
    const u = urgency.toUpperCase();
    const variant = u === 'HIGH' ? 'danger' : u === 'MEDIUM' ? 'warning' : 'success';

    return (
      <Badge variant={variant} size="xs" className="uppercase" title={`Urgency: ${u}`}>
        {u}
      </Badge>
    );
  };

  const rowPad = 'p-3.5 md:p-4';
  const metaText = 'text-xs';
  const titleText = 'text-sm';

  const headerTitle = title ?? 'Incident list';

  return (
    <div className="group relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-primary/5 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
      {/* Accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-primary/60" />
      {/* Sticky Command Bar (Bulk Actions) */}
      {(selectedCount > 0 || bulkAction) && (
        <div className="sticky top-0 z-20 border-b border-white/15 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold">{selectedCount} selected</div>
              <div className="hidden sm:block text-xs opacity-90">Tip: Shift + click for range</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {bulkAction === 'reassign' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => e.target.value && handleBulkAction('reassign', e.target.value)}
                    className="h-9 rounded-md bg-white text-slate-900 px-2 text-sm shadow-sm"
                    aria-label="Select assignee for bulk reassignment"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select assignee
                    </option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setBulkAction(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {bulkAction === 'priority' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => handleBulkAction('priority', e.target.value)}
                    className="h-9 rounded-md bg-white text-slate-900 px-2 text-sm shadow-sm"
                    aria-label="Select priority for bulk update"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select priority
                    </option>
                    <option value="">Auto (Default)</option>
                    <option value="P1">P1 - Critical</option>
                    <option value="P2">P2 - High</option>
                    <option value="P3">P3 - Medium</option>
                    <option value="P4">P4 - Low</option>
                    <option value="P5">P5 - Info</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setBulkAction(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {bulkAction === 'snooze' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => {
                      const mins = Number(e.target.value);
                      if (mins) handleBulkAction('snooze', mins);
                    }}
                    className="h-9 rounded-md bg-white text-slate-900 px-2 text-sm shadow-sm"
                    aria-label="Select snooze duration"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Snooze for
                    </option>
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="240">4 hours</option>
                    <option value="480">8 hours</option>
                    <option value="1440">24 hours</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setBulkAction(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {bulkAction === 'urgency' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => e.target.value && handleBulkAction('urgency', e.target.value)}
                    className="h-9 rounded-md bg-white text-slate-900 px-2 text-sm shadow-sm"
                    aria-label="Select urgency"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Urgency
                    </option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setBulkAction(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {bulkAction === 'status' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => e.target.value && handleBulkAction('status', e.target.value)}
                    className="h-9 rounded-md bg-white text-slate-900 px-2 text-sm shadow-sm"
                    aria-label="Select status"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Status
                    </option>
                    <option value="OPEN">TRIGGERED (OPEN)</option>
                    <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                    <option value="RESOLVED">RESOLVED</option>
                    <option value="SNOOZED">SNOOZED</option>
                    <option value="SUPPRESSED">SUPPRESSED</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setBulkAction(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {bulkAction === null && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => handleBulkAction('acknowledge')}
                  >
                    Acknowledge
                  </Button>

                  <Button
                    size="sm"
                    className="bg-white text-primary hover:bg-white/90"
                    disabled={isPending}
                    onClick={() => handleBulkAction('resolve')}
                  >
                    Resolve
                  </Button>

                  <Button size="sm" variant="secondary" onClick={() => setBulkAction('reassign')}>
                    Reassign
                  </Button>

                  <Button size="sm" variant="secondary" onClick={() => setBulkAction('priority')}>
                    Priority
                  </Button>

                  <Button size="sm" variant="secondary" onClick={() => setBulkAction('snooze')}>
                    Snooze
                  </Button>

                  <Button size="sm" variant="secondary" onClick={() => setBulkAction('urgency')}>
                    Urgency
                  </Button>

                  <Button size="sm" variant="secondary" onClick={() => setBulkAction('status')}>
                    Status
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="secondary">
                        More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onSelect={e => {
                          e.preventDefault();
                          handleBulkAction('unsnooze');
                        }}
                      >
                        Unsnooze
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={e => {
                          e.preventDefault();
                          handleBulkAction('suppress');
                        }}
                      >
                        Suppress
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={e => {
                          e.preventDefault();
                          handleBulkAction('unsuppress');
                        }}
                      >
                        Unsuppress
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={e => {
                          e.preventDefault();
                          setSelectedIds(new Set());
                          setBulkAction(null);
                          setLastSelectedIndex(null);
                        }}
                      >
                        Clear selection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Smart hint */}
                  {(selectedMeta.hasSnoozed || selectedMeta.hasSuppressed) && (
                    <div className="hidden lg:block text-xs opacity-90 ml-2">
                      Selected contains {selectedMeta.hasSnoozed ? 'SNOOZED' : ''}
                      {selectedMeta.hasSnoozed && selectedMeta.hasSuppressed ? ' + ' : ''}
                      {selectedMeta.hasSuppressed ? 'SUPPRESSED' : ''}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-4 md:px-5 py-3.5 border-b border-primary/10 flex flex-wrap justify-between items-center gap-3">
        <div className="min-w-[220px]">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-extrabold">
            {headerTitle}
          </div>
          <div className="text-sm text-slate-600 mt-0.5">
            Showing{' '}
            <span className="font-semibold text-slate-900">
              {showingFrom}-{showingTo}
            </span>{' '}
            of <span className="font-semibold text-slate-900">{totalItems}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageIncidents && (
            <Button
              type="button"
              onClick={toggleSelectAllOnPage}
              className="glass-button"
              style={{ padding: '0.45rem 0.75rem', whiteSpace: 'nowrap' }}
              aria-label="Select all incidents on page"
            >
              {selectedIds.size === incidents.length && incidents.length > 0 ? (
                <>
                  <XCircle className="mr-2 h-4 w-4 text-slate-500" />
                  Clear selection
                </>
              ) : (
                <>
                  <CheckSquare className="mr-2 h-4 w-4 text-slate-500" />
                  Select page
                </>
              )}
            </Button>
          )}

          {showExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Export incidents"
                  className="bg-white shadow-sm hover:bg-slate-50"
                >
                  <Download className="mr-2 h-4 w-4 text-slate-600" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => handleExport('csv')}>
                  <Download className="mr-2 h-4 w-4 text-slate-500" />
                  CSV (.csv)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport('xlsx')}>
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
                  Excel (.xlsx)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-3 md:p-4 lg:p-5">
        {incidents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-white p-10 text-center">
            <div className="text-4xl opacity-30 mb-3">!</div>
            <p className="text-base font-bold text-slate-700 mb-1">No incidents found</p>
            <p className="text-sm text-slate-500 m-0">Try adjusting filters to see more results.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {incidents.map((incident, idx) => {
              const incidentStatus = incident.status as IncidentStatus;
              const isSelected = selectedIds.has(incident.id);
              const urgencyChip = buildUrgencyChip(incident.urgency);

              return (
                <div
                  key={incident.id}
                  className={cn(
                    'group relative rounded-2xl border bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-all',
                    'hover:shadow-md hover:-translate-y-[1px]',
                    'focus-within:ring-2 focus-within:ring-primary/20',
                    'border-slate-200',
                    statusAccentClass[incidentStatus] ?? 'border-l-slate-300',
                    'border-l-4',
                    isSelected && 'ring-2 ring-primary/20 border-primary/40 bg-primary/5',
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
                  {/* Loading overlay */}
                  {navigatingId === incident.id && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-[1px] rounded-2xl">
                      <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium text-primary">Opening...</span>
                      </div>
                    </div>
                  )}
                  <div className={cn('flex gap-3 items-start', rowPad)}>
                    {canManageIncidents && (
                      <div data-no-row-nav="true" className="pt-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            // capture shift
                            const shiftKey = (e.nativeEvent as unknown as MouseEvent).shiftKey;
                            toggleSelectWithRange(incident.id, idx, shiftKey);
                          }}
                          className="w-4 h-4 cursor-pointer accent-primary"
                          aria-label={`Select incident ${incident.title}`}
                        />
                      </div>
                    )}

                    {/* Main layout: compact, scannable rows */}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <Link
                          href={`/incidents/${incident.id}`}
                          data-no-row-nav="true"
                          onClick={e => e.stopPropagation()}
                          className={cn(
                            'block font-extrabold text-slate-900 leading-tight truncate',
                            titleText,
                            'group-hover:text-primary transition-colors'
                          )}
                        >
                          {incident.title}
                        </Link>

                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={incidentStatus as any} size="sm" showDot />
                          <PriorityBadge priority={incident.priority} size="sm" />
                          {urgencyChip}
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

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div
                          className={cn(
                            'flex flex-wrap items-center gap-2 text-slate-500',
                            metaText
                          )}
                        >
                          <Link
                            href={`/services/${incident.service.id}`}
                            data-no-row-nav="true"
                            onClick={e => e.stopPropagation()}
                            className="text-primary font-semibold hover:underline truncate max-w-[240px]"
                          >
                            {incident.service.name}
                          </Link>

                          <span className="opacity-50">&middot;</span>

                          <span className="font-mono">#{incident.id.slice(-5).toUpperCase()}</span>

                          <span className="opacity-50">&middot;</span>

                          <span>
                            {formatDateTime(incident.createdAt, userTimeZone, {
                              format: 'short',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <AssigneeSection
                      assignee={incident.assignee}
                      incidentId={incident.id}
                      canManage={canManageIncidents}
                      users={users}
                      teams={[]}
                      team={incident.team}
                      assigneeId={incident.assigneeId}
                      teamId={incident.teamId}
                    />

                    <div className="self-start sm:self-center" data-no-row-nav="true">
                      {canManageIncidents && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200"
                              onClick={e => e.stopPropagation()}
                              aria-label="Incident actions"
                            >
                              <MoreHorizontal className="h-4 w-4 text-slate-600" />
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
                                onSelect={e => {
                                  e.preventDefault();
                                  handleStatusChange(incident.id, 'RESOLVED');
                                }}
                                className="flex items-center gap-2"
                              >
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                Resolve
                              </DropdownMenuItem>
                            )}

                            {incident.status !== 'ACKNOWLEDGED' &&
                              incident.status !== 'RESOLVED' &&
                              incident.status !== 'SUPPRESSED' && (
                                <DropdownMenuItem
                                  onSelect={e => {
                                    e.preventDefault();
                                    handleStatusChange(incident.id, 'ACKNOWLEDGED');
                                  }}
                                  className="flex items-center gap-2"
                                >
                                  <CheckCircle2 className="h-4 w-4 text-amber-600" />
                                  Acknowledge
                                </DropdownMenuItem>
                              )}

                            {incident.status === 'ACKNOWLEDGED' && (
                              <DropdownMenuItem
                                onSelect={e => {
                                  e.preventDefault();
                                  handleStatusChange(incident.id, 'OPEN');
                                }}
                                className="flex items-center gap-2"
                              >
                                <Circle className="h-4 w-4 text-slate-500" />
                                Unacknowledge
                              </DropdownMenuItem>
                            )}

                            {incident.status !== 'SNOOZED' && incident.status !== 'RESOLVED' && (
                              <DropdownMenuItem
                                onSelect={e => {
                                  e.preventDefault();
                                  handleStatusChange(incident.id, 'SNOOZED');
                                }}
                                className="flex items-center gap-2"
                              >
                                <PauseCircle className="h-4 w-4 text-slate-600" />
                                Snooze
                              </DropdownMenuItem>
                            )}

                            {incident.status === 'SNOOZED' && (
                              <DropdownMenuItem
                                onSelect={e => {
                                  e.preventDefault();
                                  handleStatusChange(incident.id, 'OPEN');
                                }}
                                className="flex items-center gap-2"
                              >
                                <CheckCircle2 className="h-4 w-4 text-slate-600" />
                                Unsnooze
                              </DropdownMenuItem>
                            )}

                            {incident.status !== 'SUPPRESSED' && incident.status !== 'RESOLVED' && (
                              <DropdownMenuItem
                                onSelect={e => {
                                  e.preventDefault();
                                  handleStatusChange(incident.id, 'SUPPRESSED');
                                }}
                                className="flex items-center gap-2"
                              >
                                <ShieldOff className="h-4 w-4 text-rose-600" />
                                Suppress
                              </DropdownMenuItem>
                            )}

                            {incident.status === 'SUPPRESSED' && (
                              <DropdownMenuItem
                                onSelect={e => {
                                  e.preventDefault();
                                  handleStatusChange(incident.id, 'OPEN');
                                }}
                                className="flex items-center gap-2"
                              >
                                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                Unsuppress
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
        />
      )}
    </div>
  );
}
