'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { useTimezone } from '@/contexts/TimezoneContext';
import { cn } from '@/lib/utils';
import type { ActionItem } from '@/lib/action-items';
import type { JiraCapability } from '@/lib/jira-capabilities';
import type { JiraIssueReference } from '@/lib/jira-references';
import { ActionItemStatus } from '@prisma/client';
import ActionItemJiraContext from '@/components/action-items/ActionItemJiraContext';
import IncidentJiraContext from '@/components/jira/IncidentJiraContext';
import DueDateBadge from '@/components/action-items/DueDateBadge';
import { EmptyState, ErrorState, FilterBar, FilterField } from '@/components/patterns';
import Pagination from '@/components/service/Pagination';
import { exportToCsv } from '@/lib/export-csv';
import { updateActionItemStatus } from '@/app/(app)/action-items/actions';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import {
  Download,
  LayoutGrid,
  List,
  CheckCircle2,
  Clock,
  AlertOctagon,
  Circle,
  MoreVertical,
  ChevronsUpDown,
  Check,
  Loader2,
  UserRound,
  FileText,
  AlertTriangle,
  SearchX,
  ListChecks,
} from 'lucide-react';

export interface BoardActionItem extends ActionItem {
  ownerName?: string;
  postmortemId: string;
  postmortemTitle: string;
  incidentId: string;
  incidentTitle: string;
  serviceId: string;
  serviceName: string;
  incidentJiraIssues: JiraIssueReference[];
  createdAt: Date;
  completedAt?: Date | string | null;
}

export interface ActionItemsBoardProps {
  actionItems: BoardActionItem[];
  users: Array<{ id: string; name: string; email: string }>;
  canManage: boolean;
  view: 'board' | 'list';
  filters: {
    status?: string;
    owner?: string;
    priority?: string;
  };
  initialSearch?: string;
  /** Per-service capability contract. Aggregate screens must never use one workspace capability. */
  jiraCapabilitiesByServiceId: Record<string, JiraCapability>;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
}

interface ActionItemCardProps {
  item: BoardActionItem;
  users: Array<{ id: string; name: string; email: string }>;
  userTimeZone: string;
  canManage: boolean;
  onStatusChange: (itemId: string, status: ActionItemStatus) => void;
  isUpdating?: boolean;
  jiraCapability: JiraCapability;
}

const STATUS_CONFIG = {
  OPEN: { color: 'text-blue-600 dark:text-blue-400', label: 'Open', icon: Circle },
  IN_PROGRESS: { color: 'text-amber-600 dark:text-amber-400', label: 'In Progress', icon: Clock },
  COMPLETED: {
    color: 'text-emerald-600 dark:text-emerald-400',
    label: 'Completed',
    icon: CheckCircle2,
  },
  BLOCKED: { color: 'text-rose-600 dark:text-rose-400', label: 'Blocked', icon: AlertOctagon },
};

const PRIORITY_CONFIG = {
  HIGH: {
    color: 'text-rose-700 dark:text-rose-300',
    bgColor: 'bg-rose-50 border-rose-200/80 dark:bg-rose-500/10 dark:border-rose-500/30',
    label: 'High',
  },
  MEDIUM: {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-50 border-amber-200/80 dark:bg-amber-500/10 dark:border-amber-500/30',
    label: 'Medium',
  },
  LOW: { color: 'text-ink-700', bgColor: 'bg-ink-100 border-ink-200/80', label: 'Low' },
};

function getOwnerName(
  ownerId: string | undefined,
  users: Array<{ id: string; name: string; email: string }>,
  ownerName?: string
) {
  if (ownerName) return ownerName;
  if (!ownerId) return 'Unassigned';
  return users.find(user => user.id === ownerId)?.name || 'Unknown';
}

const DEFAULT_FALLBACK_CAPABILITY: JiraCapability = {
  workspaceState: 'NOT_CONFIGURED',
  serviceMapped: false,
  syncEnabled: false,
  showOperationalJira: false,
  canCreate: false,
  canLink: false,
  canSync: false,
  canUnlink: false,
  reason: 'NOT_CONFIGURED',
  rawEnabled: false,
};

function requireJiraCapability(
  capabilities: ReadonlyMap<string, JiraCapability>,
  serviceId: string
): JiraCapability {
  const capability = capabilities.get(serviceId);
  return capability ?? DEFAULT_FALLBACK_CAPABILITY;
}

const STATUS_ORDER: ActionItemStatus[] = [
  ActionItemStatus.OPEN,
  ActionItemStatus.IN_PROGRESS,
  ActionItemStatus.COMPLETED,
  ActionItemStatus.BLOCKED,
];

/** Overlay link that makes the whole card open the postmortem; controls sit above it (z-10). */
const CARD_LINK_CLASS =
  'rounded-sm after:absolute after:inset-0 after:rounded-lg after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background group-hover:underline';

function statusConfigFor(status: string) {
  switch (status) {
    case 'IN_PROGRESS':
      return STATUS_CONFIG.IN_PROGRESS;
    case 'COMPLETED':
      return STATUS_CONFIG.COMPLETED;
    case 'BLOCKED':
      return STATUS_CONFIG.BLOCKED;
    default:
      return STATUS_CONFIG.OPEN;
  }
}

function priorityConfigFor(priority: string) {
  switch (priority) {
    case 'HIGH':
      return PRIORITY_CONFIG.HIGH;
    case 'LOW':
      return PRIORITY_CONFIG.LOW;
    default:
      return PRIORITY_CONFIG.MEDIUM;
  }
}

function PriorityPill({ priority }: { priority: string }) {
  const config = priorityConfigFor(priority);
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full border px-2 text-2xs font-semibold',
        config.bgColor,
        config.color
      )}
    >
      {config.label} priority
    </span>
  );
}

function StatusMenu({
  item,
  onStatusChange,
}: {
  item: BoardActionItem;
  onStatusChange: (itemId: string, status: ActionItemStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-icon-button=""
          className="relative z-10 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Change status of ${item.title}`}
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {STATUS_ORDER.map(status => {
          const config = statusConfigFor(status);
          const Icon = config.icon;
          return (
            <DropdownMenuItem
              key={status}
              onClick={() => onStatusChange(item.id, status)}
              disabled={item.status === status}
              className="gap-2"
            >
              <Icon className={cn('h-3.5 w-3.5', config.color)} aria-hidden="true" />
              <span>Set to {config.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionItemCard({
  item,
  users,
  userTimeZone,
  canManage,
  onStatusChange,
  isUpdating = false,
  jiraCapability,
}: ActionItemCardProps) {
  const inheritedIssues = item.incidentJiraIssues.filter(
    issue => issue.key !== item.externalIssue?.key
  );

  return (
    <article
      aria-busy={isUpdating || undefined}
      className={cn(
        'group relative rounded-lg border border-border bg-card p-3.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-ink-300 hover:shadow-md',
        isUpdating && 'pointer-events-none opacity-60'
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={item.priority} />
          <DueDateBadge
            dueDate={item.dueDate}
            completedAt={item.completedAt}
            status={item.status}
            userTimeZone={userTimeZone}
          />
        </div>
        {canManage && <StatusMenu item={item} onStatusChange={onStatusChange} />}
      </div>

      <h4 className="mb-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
        <Link href={`/postmortems/${item.incidentId}`} className={CARD_LINK_CLASS}>
          {item.title}
        </Link>
      </h4>
      {item.description && (
        <p className="mb-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      )}

      <div className="relative z-10 mb-2.5 flex flex-col gap-1.5">
        <IncidentJiraContext issues={inheritedIssues} compact />
        <ActionItemJiraContext
          actionItemId={item.id}
          externalIssue={item.externalIssue}
          canManage={canManage}
          compact
          jiraCapability={jiraCapability}
        />
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 font-medium text-foreground">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{getOwnerName(item.owner, users, item.ownerName)}</span>
          </span>
          <span className="max-w-[110px] truncate rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
            {item.serviceName}
          </span>
        </div>
        <div className="truncate">
          Incident{' '}
          <Link
            href={`/incidents/${item.incidentId}`}
            className="relative z-10 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.incidentTitle}
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function ActionItemsBoard({
  actionItems: initialItems,
  users,
  canManage,
  view,
  filters,
  initialSearch = '',
  jiraCapabilitiesByServiceId,
  pagination,
}: ActionItemsBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userTimeZone } = useTimezone();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState<BoardActionItem[]>(initialItems);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [selectedStatus, setSelectedStatus] = useState(filters.status || '');
  const [selectedOwner, setSelectedOwner] = useState(filters.owner || '');
  const [selectedPriority, setSelectedPriority] = useState(filters.priority || '');
  const [ownerPopoverOpen, setOwnerPopoverOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerOptions, setOwnerOptions] =
    useState<Array<{ id: string; name: string; email: string }>>(users);
  const [isSearchingOwners, setIsSearchingOwners] = useState(false);
  const [ownerSearchError, setOwnerSearchError] = useState(false);
  const [ownerSearchAttempt, setOwnerSearchAttempt] = useState(0);
  const jiraCapabilities = useMemo(
    () => new Map<string, JiraCapability>(Object.entries(jiraCapabilitiesByServiceId)),
    [jiraCapabilitiesByServiceId]
  );

  const [syncedProps, setSyncedProps] = useState({
    initialItems,
    initialSearch,
    status: filters.status,
    owner: filters.owner,
    priority: filters.priority,
  });
  if (
    syncedProps.initialItems !== initialItems ||
    syncedProps.initialSearch !== initialSearch ||
    syncedProps.status !== filters.status ||
    syncedProps.owner !== filters.owner ||
    syncedProps.priority !== filters.priority
  ) {
    setSyncedProps({
      initialItems,
      initialSearch,
      status: filters.status,
      owner: filters.owner,
      priority: filters.priority,
    });
    if (syncedProps.initialItems !== initialItems) setItems(initialItems);
    if (syncedProps.initialSearch !== initialSearch) setSearch(initialSearch);
    if (syncedProps.status !== filters.status) setSelectedStatus(filters.status || '');
    if (syncedProps.owner !== filters.owner) setSelectedOwner(filters.owner || '');
    if (syncedProps.priority !== filters.priority) setSelectedPriority(filters.priority || '');
  }

  const [ownerSearchInputs, setOwnerSearchInputs] = useState({ ownerSearch, users, selectedOwner });
  if (
    ownerSearchInputs.ownerSearch !== ownerSearch ||
    ownerSearchInputs.users !== users ||
    ownerSearchInputs.selectedOwner !== selectedOwner
  ) {
    setOwnerSearchInputs({ ownerSearch, users, selectedOwner });
    if (!ownerSearch.trim()) {
      setOwnerOptions(users);
      setIsSearchingOwners(false);
      setOwnerSearchError(false);
    } else {
      setIsSearchingOwners(true);
    }
  }

  useEffect(() => {
    if (!ownerSearch.trim()) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/action-items/owners?q=${encodeURIComponent(ownerSearch.trim())}&limit=30`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        setOwnerSearchError(false);
        const foundUsers = Array.isArray(data.users) ? data.users : [];
        const selected = users.find(u => u.id === selectedOwner);
        if (selected && !foundUsers.some((u: { id: string }) => u.id === selected.id)) {
          setOwnerOptions([selected, ...foundUsers]);
        } else {
          setOwnerOptions(foundUsers);
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setOwnerSearchError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingOwners(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ownerSearch, users, selectedOwner, ownerSearchAttempt]);

  const handleStatusChange = async (itemId: string, newStatus: ActionItemStatus) => {
    setItems(previous =>
      previous.map(item =>
        item.id === itemId
          ? {
              ...item,
              status: newStatus,
              completedAt: newStatus === ActionItemStatus.COMPLETED ? new Date() : null,
            }
          : item
      )
    );

    setUpdatingId(itemId);
    try {
      const result = await updateActionItemStatus(itemId, newStatus);
      if (!result.success) setItems(initialItems);
    } catch {
      setItems(initialItems);
    } finally {
      setUpdatingId(null);
    }
  };

  const buildFilterUrl = (updates: {
    status?: string;
    owner?: string;
    priority?: string;
    view?: string;
    search?: string;
  }) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '');
    const targetStatus = updates.status !== undefined ? updates.status : selectedStatus;
    const targetOwner = updates.owner !== undefined ? updates.owner : selectedOwner;
    const targetPriority = updates.priority !== undefined ? updates.priority : selectedPriority;
    const targetView = updates.view !== undefined ? updates.view : view;
    const targetSearch = updates.search !== undefined ? updates.search : search;

    if (targetStatus && targetStatus !== 'all') params.set('status', targetStatus);
    else params.delete('status');

    if (targetOwner && targetOwner !== 'all') params.set('owner', targetOwner);
    else params.delete('owner');

    if (targetPriority && targetPriority !== 'all') params.set('priority', targetPriority);
    else params.delete('priority');

    if (targetView && targetView !== 'board') params.set('view', targetView);
    else params.delete('view');

    if (targetSearch && targetSearch.trim()) params.set('search', targetSearch.trim());
    else {
      params.delete('search');
      params.delete('q');
    }

    params.delete('page');
    const qs = params.toString();
    return qs ? `/action-items?${qs}` : '/action-items';
  };

  const filteredItems = items;

  const groupedByStatus = useMemo(
    () => ({
      OPEN: filteredItems.filter(item => item.status === 'OPEN'),
      IN_PROGRESS: filteredItems.filter(item => item.status === 'IN_PROGRESS'),
      COMPLETED: filteredItems.filter(item => item.status === 'COMPLETED'),
      BLOCKED: filteredItems.filter(item => item.status === 'BLOCKED'),
    }),
    [filteredItems]
  );

  const handleExportCsv = () => {
    exportToCsv(
      `action-items-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Item ID', accessor: 'id' },
        { header: 'Title', accessor: 'title' },
        { header: 'Status', accessor: 'status' },
        { header: 'Priority', accessor: 'priority' },
        { header: 'Owner', accessor: row => getOwnerName(row.owner, users, row.ownerName) },
        {
          header: 'Due Date',
          accessor: row => (row.dueDate ? new Date(row.dueDate).toISOString().slice(0, 10) : ''),
        },
        { header: 'Incident', accessor: 'incidentTitle' },
        { header: 'Service', accessor: 'serviceName' },
        { header: 'Postmortem', accessor: 'postmortemTitle' },
        { header: 'Description', accessor: row => row.description || '' },
      ],
      filteredItems
    );
  };

  const hasActiveFilters =
    Boolean(search) ||
    (Boolean(selectedStatus) && selectedStatus !== 'all') ||
    (Boolean(selectedOwner) && selectedOwner !== 'all') ||
    (Boolean(selectedPriority) && selectedPriority !== 'all');

  const handleReset = () => {
    setSearch('');
    setSelectedStatus('');
    setSelectedOwner('');
    setSelectedPriority('');
    setOwnerSearch('');
    startTransition(() => router.push('/action-items'));
  };

  const emptyState = hasActiveFilters ? (
    <EmptyState
      icon={<SearchX />}
      title="No action items match these filters"
      description="Try another search term, or widen the status, owner and priority filters."
      primaryAction={
        <Button variant="outline" size="sm" onClick={handleReset}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<ListChecks />}
      title="No action items yet"
      description="Action items are the follow-up work agreed in a postmortem. Add them to a postmortem and they show up here with an owner, a due date and a status."
      primaryAction={
        <Button asChild variant="outline" size="sm">
          <Link href="/postmortems">Go to postmortems</Link>
        </Button>
      }
    />
  );

  return (
    <div className="space-y-4">
      <FilterBar
        search={{
          value: search,
          onChange: val => {
            setSearch(val);
            startTransition(() => router.push(buildFilterUrl({ search: val })));
          },
          debounceMs: 300,
          placeholder: 'Search action items, postmortems or owners…',
          label: 'Search action items',
        }}
        hasActiveFilters={hasActiveFilters}
        onClearAll={handleReset}
        filters={
          <>
            <FilterField label="Status" htmlFor="action-items-filter-status">
              <Select
                value={selectedStatus || 'all'}
                onValueChange={value => {
                  const next = value === 'all' ? '' : value;
                  setSelectedStatus(next);
                  startTransition(() => router.push(buildFilterUrl({ status: next })));
                }}
              >
                <SelectTrigger
                  id="action-items-filter-status"
                  className="h-9 w-full bg-background text-sm"
                >
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="BLOCKED">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Owner" htmlFor="action-items-filter-owner">
              <Popover open={ownerPopoverOpen} onOpenChange={setOwnerPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    id="action-items-filter-owner"
                    role="combobox"
                    aria-expanded={ownerPopoverOpen}
                    className="h-9 w-full min-w-[10rem] justify-between bg-background text-sm font-normal"
                  >
                    <span className="truncate">
                      {selectedOwner
                        ? users.find(u => u.id === selectedOwner)?.name ||
                          ownerOptions.find(u => u.id === selectedOwner)?.name ||
                          'Owner'
                        : 'All Owners'}
                    </span>
                    <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search owners..."
                      value={ownerSearch}
                      onValueChange={setOwnerSearch}
                      className="h-8 text-xs"
                    />
                    <CommandList className="max-h-[220px]">
                      {ownerSearchError && !isSearchingOwners ? (
                        <ErrorState
                          variant="inline"
                          className="border-0 py-4"
                          title="Couldn't search owners"
                          message="Check your connection and try again."
                          onRetry={() => {
                            setOwnerSearchError(false);
                            setIsSearchingOwners(true);
                            setOwnerSearchAttempt(attempt => attempt + 1);
                          }}
                        />
                      ) : isSearchingOwners ? (
                        <div className="flex items-center justify-center p-4 text-xs text-muted-foreground gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Searching owners...
                        </div>
                      ) : ownerOptions.length === 0 ? (
                        <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                          No owners found.
                        </CommandEmpty>
                      ) : (
                        <CommandGroup>
                          <CommandItem
                            value="all"
                            onSelect={() => {
                              setSelectedOwner('');
                              setOwnerPopoverOpen(false);
                              startTransition(() => router.push(buildFilterUrl({ owner: '' })));
                            }}
                            className="cursor-pointer text-xs flex items-center justify-between"
                          >
                            <span>All Owners</span>
                            {!selectedOwner && (
                              <Check className="h-3.5 w-3.5 text-primary ml-2 shrink-0" />
                            )}
                          </CommandItem>
                          {ownerOptions.map(user => (
                            <CommandItem
                              key={user.id}
                              value={user.id}
                              onSelect={() => {
                                setSelectedOwner(user.id);
                                setOwnerPopoverOpen(false);
                                startTransition(() =>
                                  router.push(buildFilterUrl({ owner: user.id }))
                                );
                              }}
                              className="cursor-pointer text-xs flex items-center justify-between"
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="truncate font-medium">{user.name}</span>
                                {user.email && (
                                  <span className="truncate text-[10px] text-muted-foreground">
                                    {user.email}
                                  </span>
                                )}
                              </div>
                              {selectedOwner === user.id && (
                                <Check className="h-3.5 w-3.5 text-primary ml-2 shrink-0" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </FilterField>

            <FilterField label="Priority" htmlFor="action-items-filter-priority">
              <Select
                value={selectedPriority || 'all'}
                onValueChange={value => {
                  const next = value === 'all' ? '' : value;
                  setSelectedPriority(next);
                  startTransition(() => router.push(buildFilterUrl({ priority: next })));
                }}
              >
                <SelectTrigger
                  id="action-items-filter-priority"
                  className="h-9 w-full bg-background text-sm"
                >
                  <SelectValue placeholder="All priorities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <nav
              aria-label="Layout"
              className="flex items-center rounded-md border border-border bg-background p-0.5"
            >
              {(
                [
                  { value: 'board', label: 'Board', Icon: LayoutGrid },
                  { value: 'list', label: 'List', Icon: List },
                ] as const
              ).map(({ value, label, Icon }) => (
                <Link
                  key={value}
                  href={buildFilterUrl({ view: value })}
                  aria-current={view === value ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-1 rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    view === value
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredItems.length === 0}
              className="h-9"
            >
              <Download aria-hidden="true" />
              Export CSV
            </Button>
          </div>
        }
      />

      {view === 'board' ? (
        filteredItems.length === 0 ? (
          emptyState
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(groupedByStatus).map(([status, groupItems]) => {
              const config = statusConfigFor(status);
              const StatusIcon = config.icon;
              return (
                <section
                  key={status}
                  aria-labelledby={`action-items-column-${status}`}
                  className="flex min-h-[320px] flex-col rounded-lg border border-border bg-muted/40 p-3"
                >
                  <header className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
                    <h3
                      id={`action-items-column-${status}`}
                      className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
                    >
                      <StatusIcon className={cn('h-4 w-4', config.color)} aria-hidden="true" />
                      {config.label}
                    </h3>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground ring-1 ring-inset ring-border">
                      {groupItems.length}
                    </span>
                  </header>
                  <div className="flex max-h-[75vh] flex-1 flex-col gap-2.5 overflow-y-auto">
                    {groupItems.length === 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                        Nothing {config.label.toLowerCase()}.
                      </p>
                    ) : (
                      groupItems.map(item => (
                        <ActionItemCard
                          key={item.id}
                          item={item}
                          users={users}
                          userTimeZone={userTimeZone}
                          canManage={canManage}
                          onStatusChange={handleStatusChange}
                          isUpdating={updatingId === item.id}
                          jiraCapability={requireJiraCapability(jiraCapabilities, item.serviceId)}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : filteredItems.length === 0 ? (
        emptyState
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredItems.map(item => {
            const statusConfig = statusConfigFor(item.status);
            const StatusIcon = statusConfig.icon;
            const isUpdating = updatingId === item.id;
            const jiraCapability = requireJiraCapability(jiraCapabilities, item.serviceId);
            const inheritedIssues = item.incidentJiraIssues.filter(
              issue => issue.key !== item.externalIssue?.key
            );

            return (
              <li
                key={item.id}
                aria-busy={isUpdating || undefined}
                className={cn(
                  'group relative rounded-lg border border-border bg-card p-4 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-ink-300 hover:shadow-md',
                  isUpdating && 'pointer-events-none opacity-60'
                )}
              >
                <div className="mb-2 flex flex-col items-start justify-between gap-3 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-semibold',
                          statusConfig.color
                        )}
                      >
                        <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {statusConfig.label}
                      </span>
                      <PriorityPill priority={item.priority} />
                      <DueDateBadge
                        dueDate={item.dueDate}
                        completedAt={item.completedAt}
                        status={item.status}
                        userTimeZone={userTimeZone}
                      />
                    </div>
                    <h3 className="mb-1 text-base font-semibold text-foreground">
                      <Link href={`/postmortems/${item.incidentId}`} className={CARD_LINK_CLASS}>
                        {item.title}
                      </Link>
                    </h3>
                    {item.description && (
                      <p className="mb-2 mt-1 text-sm text-muted-foreground">{item.description}</p>
                    )}
                    <div className="relative z-10 flex flex-col gap-1.5">
                      <IncidentJiraContext issues={inheritedIssues} compact />
                      <ActionItemJiraContext
                        actionItemId={item.id}
                        externalIssue={item.externalIssue}
                        canManage={canManage}
                        compact
                        jiraCapability={jiraCapability}
                      />
                    </div>
                  </div>

                  {canManage && (
                    <div className="relative z-10 shrink-0">
                      <Select
                        value={item.status}
                        onValueChange={value =>
                          handleStatusChange(item.id, value as ActionItemStatus)
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-[140px] bg-background text-xs"
                          aria-label={`Status of ${item.title}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {STATUS_ORDER.map(status => (
                            <SelectItem key={status} value={status}>
                              {statusConfigFor(status).label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {getOwnerName(item.owner, users, item.ownerName)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.postmortemTitle}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    <Link
                      href={`/incidents/${item.incidentId}`}
                      className="relative z-10 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.incidentTitle}
                    </Link>
                  </span>
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                    {item.serviceName}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pagination && filteredItems.length > 0 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
          itemLabel="action item"
        />
      )}
    </div>
  );
}
