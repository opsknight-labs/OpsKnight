'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { useTimezone } from '@/contexts/TimezoneContext';
import { cn } from '@/lib/utils';
import UserAvatar from '@/components/UserAvatar';
import type { ActionItem } from '@/lib/action-items';
import type { JiraCapability } from '@/lib/jira-capabilities';
import type { JiraIssueReference } from '@/lib/jira-references';
import { ActionItemStatus } from '@prisma/client';
import ActionItemJiraContext from '@/components/action-items/ActionItemJiraContext';
import IncidentJiraContext from '@/components/jira/IncidentJiraContext';
import DueDateBadge, { getDueDateStatus } from '@/components/action-items/DueDateBadge';
import {
  DirectoryGuide,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  RelativeTime,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import EmptyState from '@/components/ui/EmptyState';
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
  Columns3,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  FileText,
  Clock,
  AlertOctagon,
  Circle,
  MoreVertical,
  ChevronsUpDown,
  Check,
  Loader2,
  RotateCcw,
} from 'lucide-react';

export interface BoardActionItem extends ActionItem {
  ownerName?: string;
  ownerAvatarUrl?: string | null;
  ownerGender?: string | null;
  postmortemId: string;
  postmortemTitle: string;
  incidentId: string;
  incidentTitle: string;
  serviceId: string;
  serviceName: string;
  incidentJiraIssues: JiraIssueReference[];
  createdAt: Date;
  completedAt?: Date | string | null;
  /** The incident's problem came back on its service after this item was written. */
  causeRecurred?: boolean;
}

function CauseRecurredBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
      title="The problem behind this follow-up happened again on the same service after it was written"
    >
      <RotateCcw aria-hidden="true" className="h-3 w-3" />
      Cause recurred
    </span>
  );
}

export interface ActionItemsBoardProps {
  actionItems: BoardActionItem[];
  users: Array<{ id: string; name: string; email: string }>;
  canManage: boolean;
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
  OPEN: {
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500',
    borderColor: 'border-blue-200/80 dark:border-blue-500/30',
    hoverBorderColor: 'hover:border-blue-400',
    dotGlow: 'shadow-[0_0_8px_rgba(59,130,246,0.6)]',
    label: 'Open',
    badgeVariant: 'info' as const,
    icon: Circle,
  },
  IN_PROGRESS: {
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-500',
    borderColor: 'border-amber-200/80 dark:border-amber-500/30',
    hoverBorderColor: 'hover:border-amber-400',
    dotGlow: 'shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    label: 'In Progress',
    badgeVariant: 'warning' as const,
    icon: Clock,
  },
  COMPLETED: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-500',
    borderColor: 'border-emerald-200/80 dark:border-emerald-500/30',
    hoverBorderColor: 'hover:border-emerald-400',
    dotGlow: 'shadow-[0_0_8px_rgba(34,197,94,0.6)]',
    label: 'Completed',
    badgeVariant: 'success' as const,
    icon: CheckCircle2,
  },
  BLOCKED: {
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-500',
    borderColor: 'border-rose-200/80 dark:border-rose-500/30',
    hoverBorderColor: 'hover:border-rose-400',
    dotGlow: 'shadow-[0_0_8px_rgba(239,68,68,0.6)]',
    label: 'Blocked',
    badgeVariant: 'danger' as const,
    icon: AlertOctagon,
  },
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

const statusConfigFor = (item: BoardActionItem) => STATUS_CONFIG[item.status] || STATUS_CONFIG.OPEN;

function getOwnerName(
  ownerId: string | undefined,
  users: Array<{ id: string; name: string; email: string }>,
  ownerName?: string
) {
  if (ownerName) return ownerName;
  if (!ownerId) return 'Unassigned';
  return users.find(user => user.id === ownerId)?.name || 'Unknown';
}

/** Owner name with avatar; plain text when nobody owns the item. */
function OwnerLabel({
  item,
  users,
  className,
}: {
  item: BoardActionItem;
  users: Array<{ id: string; name: string; email: string }>;
  className?: string;
}) {
  const name = getOwnerName(item.owner, users, item.ownerName);
  if (!item.owner) return <span className={cn('truncate', className)}>{name}</span>;
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <UserAvatar
        userId={item.owner}
        avatarUrl={item.ownerAvatarUrl}
        name={name}
        gender={item.ownerGender}
        size="xs"
        aria-hidden
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Status changes offered in every item menu (board card and table row). */
function StatusMenuItems({
  item,
  onStatusChange,
}: {
  item: BoardActionItem;
  onStatusChange: (itemId: string, status: ActionItemStatus) => void;
}) {
  return (
    <>
      <DropdownMenuItem
        onClick={() => onStatusChange(item.id, ActionItemStatus.OPEN)}
        disabled={item.status === 'OPEN'}
        className="gap-2"
      >
        <Circle className="h-3.5 w-3.5 text-blue-500" />
        <span>Set to Open</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => onStatusChange(item.id, ActionItemStatus.IN_PROGRESS)}
        disabled={item.status === 'IN_PROGRESS'}
        className="gap-2"
      >
        <Clock className="h-3.5 w-3.5 text-amber-500" />
        <span>Set to In Progress</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => onStatusChange(item.id, ActionItemStatus.COMPLETED)}
        disabled={item.status === 'COMPLETED'}
        className="gap-2 text-emerald-600 focus:text-emerald-700 dark:text-emerald-400 dark:focus:text-emerald-300"
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>Mark Completed</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => onStatusChange(item.id, ActionItemStatus.BLOCKED)}
        disabled={item.status === 'BLOCKED'}
        className="gap-2 text-rose-600 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-300"
      >
        <AlertOctagon className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
        <span>Mark Blocked</span>
      </DropdownMenuItem>
    </>
  );
}

/** Due date as relative time; overdue reads in rose, due within 3 days in amber. */
function DueCell({ item }: { item: BoardActionItem }) {
  const due = getDueDateStatus(item.dueDate, item.status);
  if (due.type === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        Done
        {item.completedAt && (
          <>
            {' '}
            <RelativeTime date={item.completedAt} />
          </>
        )}
      </span>
    );
  }
  if (due.type === 'none') return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        due.type === 'overdue' && 'font-semibold text-rose-600 dark:text-rose-400',
        due.type === 'due-soon' && 'font-medium text-amber-700 dark:text-amber-300',
        due.type === 'on-track' && 'text-muted-foreground'
      )}
    >
      {due.type === 'overdue' && (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-label="Overdue" />
      )}
      <RelativeTime date={item.dueDate} />
    </span>
  );
}

function PriorityPill({ item }: { item: BoardActionItem }) {
  const config = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.MEDIUM;
  return (
    <span
      className={cn(
        'inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold',
        config.bgColor,
        config.color
      )}
    >
      {config.label}
    </span>
  );
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

function ActionItemCard({
  item,
  users,
  userTimeZone,
  canManage,
  onStatusChange,
  isUpdating = false,
  jiraCapability,
}: ActionItemCardProps) {
  const router = useRouter();
  const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.OPEN;
  const inheritedIssues = item.incidentJiraIssues.filter(
    issue => issue.key !== item.externalIssue?.key
  );

  return (
    <div
      className={cn(
        'group p-2.5 bg-card rounded-md border shadow-2xs transition-all duration-200',
        statusConfig.borderColor,
        statusConfig.hoverBorderColor,
        'hover:shadow-sm relative',
        isUpdating && 'opacity-60 pointer-events-none'
      )}
      onClick={() => router.push(`/postmortems/${item.incidentId}`)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          router.push(`/postmortems/${item.incidentId}`);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PriorityPill item={item} />
          <DueDateBadge
            dueDate={item.dueDate}
            completedAt={item.completedAt}
            status={item.status}
            userTimeZone={userTimeZone}
          />
          {item.causeRecurred && <CauseRecurredBadge />}
        </div>

        {canManage && (
          <div onClick={event => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity"
                  title="Change status"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <StatusMenuItems item={item} onStatusChange={onStatusChange} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <h4 className="text-[13px] font-semibold text-foreground mb-0.5 leading-snug line-clamp-2">
        {item.title}
      </h4>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-1 mb-1.5" title={item.description}>
          {item.description}
        </p>
      )}

      <div className="mb-1.5 flex flex-col gap-1 empty:hidden">
        <IncidentJiraContext issues={inheritedIssues} compact />
        <ActionItemJiraContext
          actionItemId={item.id}
          externalIssue={item.externalIssue}
          canManage={canManage}
          compact
          jiraCapability={jiraCapability}
        />
      </div>

      <div className="pt-1.5 border-t border-border flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <OwnerLabel
            item={item}
            users={users}
            className="max-w-[150px] font-medium text-foreground"
          />
          <span className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate max-w-[100px]">
            {item.serviceName}
          </span>
        </div>
        <div className="truncate">
          From{' '}
          <Link
            href={`/postmortems/${item.incidentId}`}
            className="hover:underline text-primary"
            onClick={event => event.stopPropagation()}
          >
            {item.incidentTitle}
          </Link>
        </div>
      </div>
    </div>
  );
}

const GUIDE_STEPS = [
  {
    title: 'Add them in a postmortem',
    description: 'Each follow-up gets a title, priority, owner and due date.',
  },
  {
    title: 'Track progress',
    description:
      'Move items through Open, In Progress, Blocked and Completed here. Overdue items are flagged.',
  },
  {
    title: 'Sync with Jira',
    description: 'Where the service has Jira connected, create or link a Jira issue for an item.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'Postmortems',
    href: '/postmortems',
    icon: <FileText className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Incidents',
    href: '/incidents',
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

export default function ActionItemsBoard({
  actionItems: initialItems,
  users,
  canManage,
  filters,
  initialSearch = '',
  jiraCapabilitiesByServiceId,
  pagination,
}: ActionItemsBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userTimeZone } = useTimezone();
  const [, startTransition] = useTransition();
  // 'cards' is the kanban board here.
  const [view, setView] = useDirectoryView('action-items');
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
        const foundUsers = Array.isArray(data.users) ? data.users : [];
        const selected = users.find(u => u.id === selectedOwner);
        if (selected && !foundUsers.some((u: { id: string }) => u.id === selected.id)) {
          setOwnerOptions([selected, ...foundUsers]);
        } else {
          setOwnerOptions(foundUsers);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          // Keep current options on error
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
  }, [ownerSearch, users, selectedOwner]);

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
    search?: string;
  }) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '');
    const targetStatus = updates.status !== undefined ? updates.status : selectedStatus;
    const targetOwner = updates.owner !== undefined ? updates.owner : selectedOwner;
    const targetPriority = updates.priority !== undefined ? updates.priority : selectedPriority;
    const targetSearch = updates.search !== undefined ? updates.search : search;

    if (targetStatus && targetStatus !== 'all') params.set('status', targetStatus);
    else params.delete('status');

    if (targetOwner && targetOwner !== 'all') params.set('owner', targetOwner);
    else params.delete('owner');

    if (targetPriority && targetPriority !== 'all') params.set('priority', targetPriority);
    else params.delete('priority');

    params.delete('view'); // retired URL toggle; the view is remembered per viewer now

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

  const rangeStart = pagination ? (pagination.currentPage - 1) * pagination.itemsPerPage + 1 : 1;

  const rowMenu = (item: BoardActionItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Actions for {item.title}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/postmortems/${item.incidentId}`}>
            <FileText />
            <span>Open postmortem</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/incidents/${item.incidentId}`}>
            <ExternalLink />
            <span>Open incident</span>
          </Link>
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <StatusMenuItems item={item} onStatusChange={handleStatusChange} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: DirectoryColumn<BoardActionItem>[] = [
    {
      id: 'item',
      header: 'Item',
      // max-w-0 + w-full: take the spare width and truncate instead of pushing columns off-screen.
      className: 'w-full max-w-0',
      cell: item => {
        const inheritedIssues = item.incidentJiraIssues.filter(
          issue => issue.key !== item.externalIssue?.key
        );
        return (
          <div className="min-w-0">
            <DirectoryPrimaryCell
              href={`/postmortems/${item.incidentId}`}
              title={<span title={item.description || item.title}>{item.title}</span>}
              titleAddon={item.causeRecurred ? <CauseRecurredBadge /> : undefined}
              subtitle={
                <>
                  <Link
                    href={`/postmortems/${item.incidentId}`}
                    className="hover:text-primary hover:underline"
                  >
                    {item.postmortemTitle}
                  </Link>
                  {' · '}
                  <Link
                    href={`/incidents/${item.incidentId}`}
                    className="hover:text-primary hover:underline"
                  >
                    {item.incidentTitle}
                  </Link>
                  {' · '}
                  <span className="font-mono">{item.serviceName}</span>
                </>
              }
            />
            <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
              <IncidentJiraContext issues={inheritedIssues} compact />
              <ActionItemJiraContext
                actionItemId={item.id}
                externalIssue={item.externalIssue}
                canManage={canManage}
                compact
                jiraCapability={requireJiraCapability(jiraCapabilities, item.serviceId)}
              />
            </div>
          </div>
        );
      },
    },
    {
      id: 'owner',
      hideable: true,
      header: 'Owner',
      className: 'hidden w-36 md:table-cell',
      cell: item => (
        <OwnerLabel item={item} users={users} className="max-w-36 text-xs text-foreground" />
      ),
    },
    {
      id: 'priority',
      hideable: true,
      header: 'Priority',
      className: 'hidden w-24 lg:table-cell',
      cell: item => <PriorityPill item={item} />,
    },
    {
      id: 'status',
      hideable: true,
      header: 'Status',
      className: 'w-36',
      cell: item =>
        canManage ? (
          <Select
            value={item.status}
            onValueChange={value => handleStatusChange(item.id, value as ActionItemStatus)}
            disabled={updatingId === item.id}
          >
            <SelectTrigger className="h-7 w-[124px] text-xs" aria-label={`Status of ${item.title}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="BLOCKED">Blocked</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Badge variant={statusConfigFor(item).badgeVariant} size="xs" className="font-semibold">
            {statusConfigFor(item).label}
          </Badge>
        ),
    },
    {
      id: 'due',
      hideable: true,
      header: 'Due',
      className: 'w-32 whitespace-nowrap',
      cell: item => <DueCell item={item} />,
    },
  ];

  const columnVisibility = useDirectoryColumns('action-items', columns);

  return (
    <div className="space-y-4">
      <SearchFilterBar
        searchValue={search}
        onSearchChange={val => {
          setSearch(val);
          startTransition(() => router.push(buildFilterUrl({ search: val })));
        }}
        searchDebounceMs={300}
        searchPlaceholder="Search action items, postmortems, owners..."
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleReset}
        filters={
          <>
            <Select
              value={selectedStatus || 'all'}
              onValueChange={value => {
                const next = value === 'all' ? '' : value;
                setSelectedStatus(next);
                startTransition(() => router.push(buildFilterUrl({ status: next })));
              }}
            >
              <SelectTrigger className="h-9 w-[130px] bg-ink-50/60 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="BLOCKED">Blocked</SelectItem>
              </SelectContent>
            </Select>

            <Popover open={ownerPopoverOpen} onOpenChange={setOwnerPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={ownerPopoverOpen}
                  aria-label="Filter by owner"
                  className="h-9 w-[150px] justify-between bg-ink-50/60 text-xs font-normal border-ink-200 hover:bg-ink-100/60"
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
                    {isSearchingOwners ? (
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

            <Select
              value={selectedPriority || 'all'}
              onValueChange={value => {
                const next = value === 'all' ? '' : value;
                setSelectedPriority(next);
                startTransition(() => router.push(buildFilterUrl({ priority: next })));
              }}
            >
              <SelectTrigger className="h-9 w-[130px] bg-ink-50/60 text-xs">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredItems.length === 0}
              className="h-9 gap-1.5 text-xs shadow-sm hover:bg-ink-100"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Export CSV</span>
            </Button>
          </div>
        }
      />

      <div className="overflow-clip rounded-lg border border-border bg-card">
        <DirectoryHeader
          title="Action items"
          summary={
            filteredItems.length > 0
              ? `Showing ${rangeStart}–${rangeStart + filteredItems.length - 1} of ${pagination?.totalItems ?? filteredItems.length}`
              : 'No matching action items'
          }
          columns={columnVisibility}
          density
          view={{
            value: view,
            onChange: setView,
            cardsLabel: 'Board view',
            cardsIcon: <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />,
          }}
          guide={
            <DirectoryGuide title="How action items work" steps={GUIDE_STEPS} links={GUIDE_LINKS} />
          }
        />
        {view === 'cards' ? (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(groupedByStatus).map(([status, groupItems]) => {
              const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
              const StatusIcon = config.icon;
              return (
                <Card
                  key={status}
                  className={cn(
                    'p-2.5 min-h-[320px] rounded-lg flex flex-col',
                    'bg-muted/40 border',
                    config.borderColor,
                    'shadow-none'
                  )}
                >
                  <CardHeader className="p-0 mb-2 pb-2 border-b border-border">
                    <div className="flex items-center justify-between">
                      <h3
                        className={cn('text-xs font-bold flex items-center gap-1.5', config.color)}
                      >
                        <StatusIcon className="h-3.5 w-3.5" />
                        <span>{config.label}</span>
                      </h3>
                      <Badge variant={config.badgeVariant} size="xs" className="font-bold">
                        {groupItems.length}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 flex flex-col gap-2 flex-1 overflow-y-auto max-h-[75vh]">
                    {groupItems.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-xs italic">
                        No items
                      </div>
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <DirectoryTable
            label="Action items"
            rows={filteredItems}
            getRowId={item => item.id}
            columns={columns}
            hiddenColumns={columnVisibility.hidden}
            rowActions={rowMenu}
            mobileRow={item => (
              <div className="min-w-0 space-y-1">
                <DirectoryPrimaryCell
                  href={`/postmortems/${item.incidentId}`}
                  title={item.title}
                  subtitle={<OwnerLabel item={item} users={users} className="mt-0.5" />}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusConfigFor(item).badgeVariant} size="xs">
                    {statusConfigFor(item).label}
                  </Badge>
                  <PriorityPill item={item} />
                  <DueCell item={item} />
                  {item.causeRecurred && <CauseRecurredBadge />}
                </div>
              </div>
            )}
            empty={
              <EmptyState
                icon={<LayoutGrid className="h-6 w-6 text-muted-foreground/60" />}
                title="No action items found"
                description={
                  hasActiveFilters
                    ? 'Try clearing or modifying your filter criteria.'
                    : 'Preventative action items from postmortems will appear here.'
                }
              />
            }
          />
        )}
        {pagination && pagination.totalPages > 1 && (
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            itemsPerPage={pagination.itemsPerPage}
            itemLabel="action item"
          />
        )}
      </div>
    </div>
  );
}
