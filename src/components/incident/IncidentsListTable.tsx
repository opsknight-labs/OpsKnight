'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
import ResolveIncidentModal, { type ResolvingIncidentData } from './ResolveIncidentModal';
import SLABreachWarningBadge from './SLABreachWarningBadge';
import { useRealtime } from '@/hooks/useRealtime';
import { Badge } from '@/components/ui/shadcn/badge';
import EmptyState from '@/components/ui/EmptyState';
import {
  AlertTriangle,
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
  const [resolvingIncident, setResolvingIncident] = useState<ResolvingIncidentData | null>(null);

  // Real-time updates & newly incoming pulse tracking
  const { recentIncidents, isConnected } = useRealtime();
  const [highlightedIncidentIds, setHighlightedIncidentIds] = useState<Set<string>>(new Set());
  const prevIncidentIdsRef = useRef<Set<string>>(new Set(incidents.map(i => i.id)));

  // Keyboard navigation focus index & global G sequence coordination
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastGTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!recentIncidents || recentIncidents.length === 0) return;

    const newIds: string[] = [];
    for (const item of recentIncidents) {
      const id = typeof item.id === 'string' ? item.id : null;
      if (id && !prevIncidentIdsRef.current.has(id)) {
        newIds.push(id);
        prevIncidentIdsRef.current.add(id);
      }
    }

    if (newIds.length > 0) {
      setHighlightedIncidentIds(prev => {
        const next = new Set(prev);
        newIds.forEach(id => next.add(id));
        return next;
      });

      router.refresh();

      const timer = setTimeout(() => {
        setHighlightedIncidentIds(prev => {
          const next = new Set(prev);
          newIds.forEach(id => next.delete(id));
          return next;
        });
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [recentIncidents, router]);

  useEffect(() => {
    if (focusedIndex !== null) {
      const el = rowRefs.current.get(focusedIndex);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIndex]);

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
    let hasSnoozed = false;
    let hasSuppressed = false;
    for (const inc of incidents) {
      if (!selectedIds.has(inc.id)) continue;
      if (inc.status === 'SNOOZED') hasSnoozed = true;
      if (inc.status === 'SUPPRESSED') hasSuppressed = true;
      if (hasSnoozed && hasSuppressed) break;
    }
    return { hasSnoozed, hasSuppressed };
  }, [selectedIds, incidents]);

  const handleStatusChange = useCallback(
    async (incidentId: string, status: IncidentStatus) => {
      if (status === 'RESOLVED') {
        const inc = incidents.find(i => i.id === incidentId);
        if (inc) {
          setResolvingIncident({
            id: inc.id,
            title: inc.title,
            service: inc.service,
          });
        }
        return;
      }

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
    },
    [incidents, router, showToast]
  );

  const toggleSelectAllOnPage = () => {
    if (selectedIds.size === incidents.length) {
      setSelectedIds(new Set());
      setLastSelectedIndex(null);
      return;
    }
    setSelectedIds(new Set(incidents.map(i => i.id)));
    setLastSelectedIndex(incidents.length - 1);
  };

  const toggleSelectWithRange = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelectedIds(prev => {
        const next = new Set(prev);

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
        return next;
      });

      setLastSelectedIndex(index);
    },
    [incidents, lastSelectedIndex]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input, textarea, contentEditable, or inside a modal dialog
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (typeof target.closest === 'function' && target.closest('[role="dialog"]')))
      ) {
        return;
      }

      // Preserve keyboard shortcuts with modifiers (Cmd+C, Cmd+N, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      // Track G key for global navigation (G+D, G+I, G+S, G+T, G+U, G+C, G+P, G+A)
      if (key === 'g') {
        lastGTimeRef.current = Date.now();
        return;
      }

      // If G was recently pressed (< 1000ms), let GlobalKeyboardHandler handle it without interference
      if (Date.now() - lastGTimeRef.current < 1000) {
        return;
      }

      // Preserve global navigation (N for new incident, C for quick create, ? for help)
      if (key === 'n' || key === 'c' || e.key === '?') {
        return;
      }

      const focused = focusedIndex !== null ? incidents.at(focusedIndex) : null;

      // Open focused incident
      if (e.key === 'Enter' || key === 'o') {
        if (focused) {
          e.preventDefault();
          setNavigatingId(focused.id);
          startTransition(() => {
            router.push(`/incidents/${focused.id}`);
          });
        }
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(prev => {
          if (incidents.length === 0) return null;
          if (prev === null) return 0;
          return Math.min(prev + 1, incidents.length - 1);
        });
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => {
          if (incidents.length === 0) return null;
          if (prev === null) return 0;
          return Math.max(prev - 1, 0);
        });
        return;
      }

      if (key === 'x') {
        if (focused && focusedIndex !== null) {
          e.preventDefault();
          toggleSelectWithRange(focused.id, focusedIndex, false);
        }
        return;
      }

      if (key === 'a') {
        if (focused && canManageIncidents && focused.status === 'OPEN') {
          e.preventDefault();
          handleStatusChange(focused.id, 'ACKNOWLEDGED');
        }
        return;
      }

      if (key === 'r' || key === 'e') {
        if (focused && canManageIncidents && focused.status !== 'RESOLVED') {
          e.preventDefault();
          setResolvingIncident({
            id: focused.id,
            title: focused.title,
            service: focused.service,
          });
        }
        return;
      }

      if (e.key === '/') {
        const searchInput = document.getElementById('incident-search');
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
        } else if (focusedIndex !== null) {
          e.preventDefault();
          setFocusedIndex(null);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    incidents,
    focusedIndex,
    canManageIncidents,
    selectedIds,
    handleStatusChange,
    router,
    toggleSelectWithRange,
  ]);

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

  const headerTitle = title ?? 'Incident list';

  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
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
      <div className="px-4 md:px-5 py-3.5 border-b border-border/60 flex flex-wrap justify-between items-center gap-3">
        <div className="min-w-[220px]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
              {headerTitle}
            </span>
            {isConnected && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Live
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Showing{' '}
            <span className="font-semibold text-foreground">
              {showingFrom}-{showingTo}
            </span>{' '}
            of <span className="font-semibold text-foreground">{totalItems}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Subtle keyboard shortcuts guide */}
          <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mr-1 select-none">
            <span>Shortcuts:</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">
              J
            </kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">
              K
            </kbd>
            <span>nav</span>
            <span className="opacity-40">&middot;</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">
              X
            </kbd>
            <span>select</span>
            <span className="opacity-40">&middot;</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">
              A
            </kbd>
            <span>ack</span>
            <span className="opacity-40">&middot;</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">
              R
            </kbd>
            <span>resolve</span>
            <span className="opacity-40">&middot;</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">
              /
            </kbd>
            <span>search</span>
          </div>
          {canManageIncidents && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleSelectAllOnPage}
              className="h-8 gap-1.5 text-xs font-medium border-border/80 hover:bg-accent cursor-pointer"
              aria-label="Select all incidents on page"
            >
              {selectedIds.size === incidents.length && incidents.length > 0 ? (
                <>
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Clear selection</span>
                </>
              ) : (
                <>
                  <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Select page</span>
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
                  className="h-8 gap-1.5 text-xs font-medium border-border/80 hover:bg-accent cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 p-1 rounded-xl shadow-xl">
                <DropdownMenuItem
                  onSelect={() => handleExport('csv')}
                  className="text-xs cursor-pointer py-1.5"
                >
                  <Download className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span>CSV (.csv)</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleExport('xlsx')}
                  className="text-xs cursor-pointer py-1.5"
                >
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Excel (.xlsx)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-3 md:p-4 lg:p-5">
        {incidents.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="No incidents found"
            description="There are no incidents matching your active filter criteria. Try adjusting or clearing filters to see more results."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/incidents">Clear all filters</Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {incidents.map((incident, idx) => {
              const incidentStatus = incident.status as IncidentStatus;
              const isSelected = selectedIds.has(incident.id);
              const urgencyChip = buildUrgencyChip(incident.urgency);
              const isFocused = focusedIndex === idx;
              const isNewlyIncoming = highlightedIncidentIds.has(incident.id);

              return (
                <div
                  key={incident.id}
                  ref={el => {
                    if (el) {
                      rowRefs.current.set(idx, el);
                    } else {
                      rowRefs.current.delete(idx);
                    }
                  }}
                  className={cn(
                    'group relative rounded-2xl border bg-card transition-all duration-200 overflow-hidden',
                    'hover:shadow-md hover:border-border',
                    'focus-within:ring-2 focus-within:ring-primary/20',
                    'border-border/75',
                    getStatusHoverBorder(incidentStatus),
                    isSelected && 'ring-1 ring-primary/30 border-primary/50 bg-primary/5',
                    isFocused && 'ring-2 ring-primary/60 border-primary/70 shadow-sm bg-accent/25',
                    isNewlyIncoming &&
                      'ring-2 ring-emerald-500/60 bg-emerald-500/[0.06] animate-pulse',
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
                      isSelected
                        ? 'w-1.5 opacity-100'
                        : 'opacity-80 group-hover:opacity-100 group-hover:w-1.25'
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
                  <div className="flex gap-3 items-center pl-4 pr-3.5 py-3.5 md:py-4">
                    {canManageIncidents && (
                      <div data-no-row-nav="true" className="shrink-0 flex items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            // capture shift
                            const shiftKey = (e.nativeEvent as unknown as MouseEvent).shiftKey;
                            toggleSelectWithRange(incident.id, idx, shiftKey);
                          }}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/40 focus:ring-offset-0 cursor-pointer transition-colors"
                          aria-label={`Select incident ${incident.title}`}
                        />
                      </div>
                    )}

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
                          <SLABreachWarningBadge incident={incident} service={incident.service} />
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

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/services/${incident.service.id}`}
                            data-no-row-nav="true"
                            onClick={e => e.stopPropagation()}
                            className="text-primary font-semibold hover:underline truncate max-w-[240px]"
                          >
                            {incident.service.name}
                          </Link>

                          <span className="opacity-40">&middot;</span>

                          <span className="font-mono text-muted-foreground/80">
                            #{incident.id.slice(-5).toUpperCase()}
                          </span>

                          <span className="opacity-40">&middot;</span>

                          <span
                            className="cursor-help transition-colors hover:text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                            title={formatDateTime(incident.createdAt, userTimeZone, {
                              format: 'datetime',
                              includeTimeZone: true,
                            })}
                          >
                            {formatDateTime(incident.createdAt, userTimeZone, {
                              format: 'relative',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pl-1">
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

                      {/* Quick triage actions */}
                      {canManageIncidents && incidentStatus === 'OPEN' && (
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

                      {canManageIncidents && incidentStatus === 'ACKNOWLEDGED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-no-row-nav="true"
                          onClick={e => {
                            e.stopPropagation();
                            setResolvingIncident({
                              id: incident.id,
                              title: incident.title,
                              service: incident.service,
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

                      {canManageIncidents && (
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
                                  onSelect={e => {
                                    e.preventDefault();
                                    setResolvingIncident({
                                      id: incident.id,
                                      title: incident.title,
                                      service: incident.service,
                                    });
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

                              {incident.status !== 'SUPPRESSED' &&
                                incident.status !== 'RESOLVED' && (
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
                        </div>
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

      {/* Centralized Resolve Incident Modal */}
      <ResolveIncidentModal
        incident={resolvingIncident}
        open={!!resolvingIncident}
        onOpenChange={open => {
          if (!open) setResolvingIncident(null);
        }}
      />
    </div>
  );
}
