'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import Pagination from './Pagination';

import EscalationStatusBadge from './EscalationStatusBadge';
import StatusBadge from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';
import RelativeTime from '@/components/patterns/RelativeTime';
import EmptyState from '@/components/patterns/EmptyState';
import AssigneeSection from './AssigneeSection';
import ResolveIncidentModal, { type ResolvingIncidentData } from './ResolveIncidentModal';
import SLABreachWarningBadge from './SLABreachWarningBadge';
import { useRealtime } from '@/hooks/useRealtime';
import { useIncidentSlaState } from '@/hooks/useIncidentSlaState';
import {
  mergeRealtimeIncidents,
  newIncidentsLabel,
  type IncidentRealtimeFilter,
} from './incidents-realtime';
import { INCIDENT_SEARCH_LABEL } from './IncidentsFilters';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  MoreHorizontal,
  PauseCircle,
  Plus,
  SearchX,
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

export { matchesRealtimeFilter } from './incidents-realtime';

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
  /** Shows "Create incident" in the first-run empty state. */
  canCreateIncident?: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  title?: string;
  showExport?: boolean;
  readOnly?: boolean;
  emptyState?: { title: string; description: string };
  realtimeFilter?: IncidentRealtimeFilter;
};

type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
type BulkActionMode = 'reassign' | 'priority' | 'snooze' | 'urgency' | 'status' | null;

/** URL params that only shape the view, never which incidents match. */
const NON_FILTER_PARAMS = new Set(['page', 'sort']);

const bulkSelectClass =
  'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function IncidentListSlaBadge({ incident }: { incident: IncidentListItem }) {
  const state = useIncidentSlaState(incident);
  return <SLABreachWarningBadge state={state} />;
}

export default function IncidentsListTable({
  incidents,
  users,
  canManageIncidents,
  canCreateIncident = false,
  pagination,
  title,
  showExport = true,
  readOnly = false,
  emptyState,
  realtimeFilter = {},
}: IncidentsListTableProps) {
  const isManageable = !readOnly && canManageIncidents;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { openCreateIncident } = useCreateIncidentModal();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkActionMode>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [resolvingIncident, setResolvingIncident] = useState<ResolvingIncidentData | null>(null);

  // Local displayed list for instant optimistic real-time updates
  const [displayedIncidents, setDisplayedIncidents] = useState<IncidentListItem[]>(incidents);
  const [prevIncidents, setPrevIncidents] = useState<IncidentListItem[]>(incidents);
  // Matching incidents that arrived in realtime but are not on this page / in this sort window.
  const [offscreenNewIds, setOffscreenNewIds] = useState<ReadonlySet<string>>(new Set());
  if (prevIncidents !== incidents) {
    setPrevIncidents(incidents);
    setDisplayedIncidents(incidents);
    setOffscreenNewIds(new Set());
  }

  const displayedRef = useRef<IncidentListItem[]>(incidents);
  useEffect(() => {
    displayedRef.current = displayedIncidents;
  }, [displayedIncidents]);

  const handleStatusChange = useCallback(
    async (incidentId: string, status: IncidentStatus) => {
      if (status === 'RESOLVED') {
        const inc = displayedIncidents.find(i => i.id === incidentId);
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
    [displayedIncidents, router, showToast]
  );

  // Real-time updates & newly incoming pulse tracking
  const { recentIncidents, isConnected } = useRealtime();
  const [highlightedIncidentIds, setHighlightedIncidentIds] = useState<Set<string>>(new Set());

  // Keyboard navigation focus index & global G sequence coordination
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const lastGTimeRef = useRef<number>(0);

  const mountedAtRef = useRef<number>(0);
  useEffect(() => {
    if (!mountedAtRef.current) {
      mountedAtRef.current = Date.now();
    }
  }, []);
  const isPageOne = !pagination || pagination.currentPage === 1;
  const maxItems = pagination?.itemsPerPage ?? Math.max(incidents.length, 15);
  // Callers often pass the filter inline; key the effect on its content, not its identity.
  const realtimeFilterKey = JSON.stringify(realtimeFilter);
  const realtimeFilterRef = useRef(realtimeFilter);
  useEffect(() => {
    realtimeFilterRef.current = realtimeFilter;
  });

  useEffect(() => {
    if (!recentIncidents || recentIncidents.length === 0) return;

    const { list, insertedIds, offscreenIds } = mergeRealtimeIncidents(
      displayedRef.current,
      recentIncidents,
      {
        filter: realtimeFilterRef.current,
        isPageOne,
        maxItems,
        // Same 60s grace as the arrival highlight, for clock skew against the server.
        newSince: (mountedAtRef.current || Date.now()) - 60_000,
      }
    );

    if (list !== displayedRef.current) {
      displayedRef.current = list;
      setDisplayedIncidents(list);
    }

    setOffscreenNewIds(prev => {
      const visible = new Set(list.map(item => item.id));
      const next = new Set([...prev].filter(id => !visible.has(id)));
      offscreenIds.forEach(id => next.add(id));
      if (next.size === prev.size && [...next].every(id => prev.has(id))) return prev;
      return next;
    });

    if (insertedIds.length > 0) {
      setHighlightedIncidentIds(prev => {
        const next = new Set(prev);
        insertedIds.forEach(id => next.add(id));
        return next;
      });

      const timer = setTimeout(() => {
        setHighlightedIncidentIds(prev => {
          const next = new Set(prev);
          insertedIds.forEach(id => next.delete(id));
          return next;
        });
      }, 4500);

      return () => clearTimeout(timer);
    }
  }, [recentIncidents, realtimeFilterKey, isPageOne, maxItems]);

  useEffect(() => {
    if (focusedIndex === null) return;
    const row = rowRefs.current.get(focusedIndex);
    const link = row?.querySelector<HTMLAnchorElement>('a[data-row-link]');
    // J/K move real focus so the row's focus ring and screen readers follow along.
    if (link && document.activeElement !== link && !row?.contains(document.activeElement)) {
      link.focus({ preventScroll: true });
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [focusedIndex]);

  // User-initiated: the realtime effect above never refreshes the route by itself.
  const showNewIncidents = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    const query = params.toString();
    const target = query ? `/incidents?${query}` : '/incidents';
    startTransition(() => {
      if (searchParams.has('page')) router.push(target);
      else router.refresh();
    });
  }, [router, searchParams]);

  const hasActiveFilters = useMemo(
    () => [...searchParams.keys()].some(key => !NON_FILTER_PARAMS.has(key)),
    [searchParams]
  );

  const totalItems = pagination?.totalItems ?? displayedIncidents.length;
  const showingFrom =
    pagination && totalItems > 0
      ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1
      : totalItems > 0
        ? 1
        : 0;
  const showingTo = pagination
    ? Math.min(pagination.currentPage * pagination.itemsPerPage, totalItems)
    : Math.min(displayedIncidents.length, totalItems);

  const selectedCount = selectedIds.size;

  const selectedMeta = useMemo(() => {
    let hasSnoozed = false;
    let hasSuppressed = false;
    for (const inc of displayedIncidents) {
      if (!selectedIds.has(inc.id)) continue;
      if (inc.status === 'SNOOZED') hasSnoozed = true;
      if (inc.status === 'SUPPRESSED') hasSuppressed = true;
      if (hasSnoozed && hasSuppressed) break;
    }
    return { hasSnoozed, hasSuppressed };
  }, [selectedIds, displayedIncidents]);

  const toggleSelectAllOnPage = () => {
    if (selectedIds.size === displayedIncidents.length) {
      setSelectedIds(new Set());
      setLastSelectedIndex(null);
      return;
    }
    setSelectedIds(new Set(displayedIncidents.map(i => i.id)));
    setLastSelectedIndex(displayedIncidents.length - 1);
  };

  const toggleSelectWithRange = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelectedIds(prev => {
        const next = new Set(prev);

        // If shift pressed and we have a prior index, select a range
        if (shiftKey && lastSelectedIndex !== null) {
          const [from, to] =
            index > lastSelectedIndex ? [lastSelectedIndex, index] : [index, lastSelectedIndex];
          const rangeIds = displayedIncidents.slice(from, to + 1).map(i => i.id);

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
    [displayedIncidents, lastSelectedIndex]
  );

  useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in a text field, contentEditable, or inside a modal dialog. Row checkboxes
      // are inputs too, but J/K/X must keep working from them.
      const target = e.target as HTMLElement | null;
      const isTextEntry =
        target?.tagName === 'INPUT' &&
        !['checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type);
      if (
        target &&
        (isTextEntry ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
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

      const focused = focusedIndex !== null ? displayedIncidents.at(focusedIndex) : null;

      // Open focused incident
      if (e.key === 'Enter' || key === 'o') {
        if (focused && target?.tagName !== 'INPUT') {
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
          if (displayedIncidents.length === 0) return null;
          if (prev === null) return 0;
          return Math.min(prev + 1, displayedIncidents.length - 1);
        });
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => {
          if (displayedIncidents.length === 0) return null;
          if (prev === null) return 0;
          return Math.max(prev - 1, 0);
        });
        return;
      }

      if (key === 'x') {
        if (focused && focusedIndex !== null && isManageable) {
          e.preventDefault();
          toggleSelectWithRange(focused.id, focusedIndex, false);
        }
        return;
      }

      if (key === 'a') {
        if (focused && isManageable && focused.status === 'OPEN') {
          e.preventDefault();
          handleStatusChange(focused.id, 'ACKNOWLEDGED');
        }
        return;
      }

      if (key === 'r' || key === 'e') {
        if (focused && isManageable && focused.status !== 'RESOLVED') {
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
        const searchInput = document.querySelector<HTMLInputElement>(
          `input[aria-label="${INCIDENT_SEARCH_LABEL}"]`
        );
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
    readOnly,
    displayedIncidents,
    focusedIndex,
    isManageable,
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

  const headerTitle = title ?? 'Incident list';
  const newCount = offscreenNewIds.size;
  const newLabel = newIncidentsLabel(newCount);

  const openIncident = (event: ReactMouseEvent, id: string) => {
    // New-tab and modified clicks leave this page as it is.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    setNavigatingId(id);
  };

  const bulkCancel = (
    <Button variant="secondary" size="sm" onClick={() => setBulkAction(null)}>
      Cancel
    </Button>
  );

  return (
    <section
      aria-label={headerTitle}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-xs"
    >
      {/* Sticky command bar (bulk actions) */}
      {!readOnly && (selectedCount > 0 || bulkAction) && (
        <div className="sticky top-0 z-20 border-b border-border bg-primary text-primary-foreground">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold tabular-nums" aria-live="polite">
                {selectedCount} selected
              </div>
              <div className="hidden text-xs opacity-90 sm:block">Tip: Shift + click for range</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {bulkAction === 'reassign' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => e.target.value && handleBulkAction('reassign', e.target.value)}
                    className={bulkSelectClass}
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
                  {bulkCancel}
                </div>
              )}

              {bulkAction === 'priority' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => handleBulkAction('priority', e.target.value)}
                    className={bulkSelectClass}
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
                  {bulkCancel}
                </div>
              )}

              {bulkAction === 'snooze' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => {
                      const mins = Number(e.target.value);
                      if (mins) handleBulkAction('snooze', mins);
                    }}
                    className={bulkSelectClass}
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
                  {bulkCancel}
                </div>
              )}

              {bulkAction === 'urgency' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => e.target.value && handleBulkAction('urgency', e.target.value)}
                    className={bulkSelectClass}
                    aria-label="Select urgency"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Urgency
                    </option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                  {bulkCancel}
                </div>
              )}

              {bulkAction === 'status' && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={e => e.target.value && handleBulkAction('status', e.target.value)}
                    className={bulkSelectClass}
                    aria-label="Select status"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Status
                    </option>
                    <option value="OPEN">Triggered</option>
                    <option value="ACKNOWLEDGED">Acknowledged</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="SNOOZED">Snoozed</option>
                    <option value="SUPPRESSED">Suppressed</option>
                  </select>
                  {bulkCancel}
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
                    className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
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

                  {(selectedMeta.hasSnoozed || selectedMeta.hasSuppressed) && (
                    <div className="ml-2 hidden text-xs opacity-90 lg:block">
                      Selection includes {selectedMeta.hasSnoozed ? 'snoozed' : ''}
                      {selectedMeta.hasSnoozed && selectedMeta.hasSuppressed ? ' and ' : ''}
                      {selectedMeta.hasSuppressed ? 'suppressed' : ''} incidents
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{headerTitle}</h2>
            {isConnected && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            Showing{' '}
            <span className="font-medium text-foreground">
              {showingFrom}–{showingTo}
            </span>{' '}
            of <span className="font-medium text-foreground">{totalItems}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <div
              className="mr-1 hidden select-none items-center gap-1.5 text-xs text-muted-foreground xl:flex"
              aria-label="Keyboard shortcuts"
            >
              <span>Shortcuts:</span>
              {(
                [
                  ['J', 'K', 'nav'],
                  ['X', null, 'select'],
                  ['A', null, 'ack'],
                  ['R', null, 'resolve'],
                  ['/', null, 'search'],
                ] as const
              ).map(([first, second, label], idx) => (
                <span key={label} className="inline-flex items-center gap-1">
                  {idx > 0 && (
                    <span aria-hidden="true" className="opacity-40">
                      &middot;
                    </span>
                  )}
                  <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs">
                    {first}
                  </kbd>
                  {second && (
                    <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs">
                      {second}
                    </kbd>
                  )}
                  <span>{label}</span>
                </span>
              ))}
            </div>
          )}
          {isManageable && displayedIncidents.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleSelectAllOnPage}
              className="h-8 gap-1.5 text-xs"
              aria-label={
                selectedIds.size === displayedIncidents.length
                  ? 'Clear selection'
                  : 'Select all incidents on page'
              }
            >
              {selectedIds.size === displayedIncidents.length ? (
                <>
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>Clear selection</span>
                </>
              ) : (
                <>
                  <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
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
                  className="h-8 gap-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => handleExport('csv')} className="text-xs">
                  <Download className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <span>CSV (.csv)</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport('xlsx')} className="text-xs">
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <span>Excel (.xlsx)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Realtime arrivals that are not on this page or in this sort window */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {newCount > 0 && (
          <div className="flex justify-center border-b border-border bg-muted/40 px-4 py-2">
            <button
              type="button"
              onClick={showNewIncidents}
              data-testid="new-incidents-pill"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-800 shadow-xs transition-colors duration-150 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/20"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="tabular-nums">{newLabel}</span>
              <span aria-hidden="true" className="opacity-60">
                —
              </span>
              <span className="font-semibold underline-offset-2">Show</span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 md:p-4">
        {displayedIncidents.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon={<SearchX />}
              title="No incidents match these filters"
              description="Nothing in your scope matches the current search and filters. Clear them to see every incident."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/incidents">Clear filters</Link>
                </Button>
              }
            />
          ) : emptyState ? (
            <EmptyState
              icon={<AlertTriangle />}
              title={emptyState.title}
              description={emptyState.description}
            />
          ) : (
            <EmptyState
              icon={<CheckCircle2 />}
              title="No incidents yet"
              description="Incidents open when a service's integration sends an alert, or when a responder declares one. They will appear here in real time."
              action={
                canCreateIncident ? (
                  <Button size="sm" onClick={() => openCreateIncident()}>
                    <Plus aria-hidden="true" />
                    Create incident
                  </Button>
                ) : undefined
              }
              secondaryAction={
                <Button asChild variant="outline" size="sm">
                  <Link href="/services">Connect a service</Link>
                </Button>
              }
            />
          )
        ) : (
          <ul
            className="flex flex-col gap-2"
            aria-label={`${headerTitle}, ${totalItems} incidents`}
          >
            {displayedIncidents.map((incident, idx) => {
              const incidentStatus = incident.status as IncidentStatus;
              const isSelected = !readOnly && selectedIds.has(incident.id);
              const isFocused = !readOnly && focusedIndex === idx;
              const isNewlyIncoming = highlightedIncidentIds.has(incident.id);
              const canAck = isManageable && incidentStatus === 'OPEN';
              const canResolve = isManageable && incidentStatus !== 'RESOLVED';

              return (
                <li
                  key={incident.id}
                  ref={el => {
                    if (el) {
                      rowRefs.current.set(idx, el);
                    } else {
                      rowRefs.current.delete(idx);
                    }
                  }}
                  onFocus={() => {
                    if (!readOnly && focusedIndex !== idx) setFocusedIndex(idx);
                  }}
                  data-incident-row={incident.id}
                  data-status={incidentStatus.toLowerCase()}
                  className={cn(
                    'group relative rounded-lg border border-border bg-card transition-colors duration-150',
                    'hover:border-ink-300 hover:bg-muted/40',
                    isSelected && 'border-primary/50 bg-primary/5',
                    isFocused && 'border-ink-400 bg-muted/40',
                    isNewlyIncoming &&
                      'border-blue-300 bg-blue-50/60 dark:border-blue-500/40 dark:bg-blue-500/10',
                    navigatingId === incident.id && 'opacity-70'
                  )}
                >
                  {navigatingId === incident.id && (
                    <div
                      className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-card/70"
                      role="status"
                    >
                      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
                        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                        Opening…
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center md:px-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {isManageable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            const shiftKey = (e.nativeEvent as unknown as MouseEvent).shiftKey;
                            toggleSelectWithRange(incident.id, idx, shiftKey);
                          }}
                          className="relative z-10 mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-sm border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={`Select incident ${incident.title}`}
                        />
                      )}

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          {/* The title link covers the whole row (stretched link), so the row is
                              clickable without nesting controls inside another control. */}
                          <Link
                            href={`/incidents/${incident.id}`}
                            data-row-link
                            onClick={e => openIncident(e, incident.id)}
                            className="min-w-0 max-w-full truncate text-sm font-semibold leading-snug text-foreground after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring md:text-base"
                          >
                            {incident.title}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isNewlyIncoming && (
                              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-2xs font-semibold text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                                New
                              </span>
                            )}
                            <StatusBadge
                              status={incidentStatus}
                              size="xs"
                              live={incidentStatus === 'OPEN'}
                            />
                            <SeverityBadge priority={incident.priority} size="xs" />
                            <SeverityBadge urgency={incident.urgency} size="xs" />
                            <IncidentListSlaBadge incident={incident} />
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

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <Link
                            href={`/services/${incident.service.id}`}
                            className="relative z-10 max-w-[240px] truncate rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {incident.service.name}
                          </Link>
                          <span aria-hidden="true" className="opacity-40">
                            &middot;
                          </span>
                          <span className="font-mono tabular-nums">
                            #{incident.id.slice(-5).toUpperCase()}
                          </span>
                          <span aria-hidden="true" className="opacity-40">
                            &middot;
                          </span>
                          <RelativeTime
                            date={incident.createdAt}
                            className="relative z-10 cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-2"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 pl-7 sm:pl-0">
                      <AssigneeSection
                        assignee={incident.assignee}
                        incidentId={incident.id}
                        canManage={isManageable}
                        users={users}
                        teams={[]}
                        team={incident.team}
                        assigneeId={incident.assigneeId}
                        teamId={incident.teamId}
                      />

                      {canAck && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(incident.id, 'ACKNOWLEDGED')}
                          disabled={isPending}
                          aria-label={`Acknowledge incident: ${incident.title}`}
                          className="h-11 gap-1 px-3 text-xs font-semibold sm:h-8"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Acknowledge</span>
                        </Button>
                      )}

                      {canResolve && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setResolvingIncident({
                              id: incident.id,
                              title: incident.title,
                              service: incident.service,
                            })
                          }
                          disabled={isPending}
                          aria-label={`Resolve incident: ${incident.title}`}
                          className="h-11 gap-1 border-emerald-300 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200 sm:h-8"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Resolve</span>
                        </Button>
                      )}

                      {isManageable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8"
                              aria-label={`More actions for ${incident.title}`}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>

                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/incidents/${incident.id}`}
                                className="flex items-center gap-2"
                              >
                                <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
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
                                <CheckCircle2
                                  className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden
                                />
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
                                  <CheckCircle2
                                    className="h-4 w-4 text-amber-600 dark:text-amber-400"
                                    aria-hidden
                                  />
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
                                <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
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
                                <PauseCircle
                                  className="h-4 w-4 text-muted-foreground"
                                  aria-hidden
                                />
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
                                <CheckCircle2
                                  className="h-4 w-4 text-muted-foreground"
                                  aria-hidden
                                />
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
                                <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden />
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
                                <ShieldCheck
                                  className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden
                                />
                                Unsuppress
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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
    </section>
  );
}
