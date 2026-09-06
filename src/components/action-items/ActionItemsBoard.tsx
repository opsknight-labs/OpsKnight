'use client';

import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { useTimezone } from '@/contexts/TimezoneContext';
import { cn } from '@/lib/utils';
import type { ActionItem } from '@/lib/action-items';
import { ActionItemStatus } from '@prisma/client';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import DueDateBadge from '@/components/action-items/DueDateBadge';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import EmptyState from '@/components/ui/EmptyState';
import { exportToCsv } from '@/lib/export-csv';
import { updateActionItemStatus } from '@/app/(app)/action-items/actions';
import {
  Download,
  LayoutGrid,
  List,
  CheckCircle2,
  Clock,
  AlertOctagon,
  Circle,
  MoreVertical,
} from 'lucide-react';

export interface BoardActionItem extends ActionItem {
  postmortemId: string;
  postmortemTitle: string;
  incidentId: string;
  incidentTitle: string;
  serviceName: string;
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
}

interface ActionItemCardProps {
  item: BoardActionItem;
  users: Array<{ id: string; name: string; email: string }>;
  userTimeZone: string;
  canManage: boolean;
  onStatusChange: (itemId: string, status: ActionItemStatus) => void;
  isUpdating?: boolean;
}

const STATUS_CONFIG = {
  OPEN: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-500',
    borderColor: 'border-blue-200/80',
    hoverBorderColor: 'hover:border-blue-400',
    dotGlow: 'shadow-[0_0_8px_rgba(59,130,246,0.6)]',
    label: 'Open',
    badgeVariant: 'info' as const,
    icon: Circle,
  },
  IN_PROGRESS: {
    color: 'text-amber-600',
    bgColor: 'bg-amber-500',
    borderColor: 'border-amber-200/80',
    hoverBorderColor: 'hover:border-amber-400',
    dotGlow: 'shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    label: 'In Progress',
    badgeVariant: 'warning' as const,
    icon: Clock,
  },
  COMPLETED: {
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-500',
    borderColor: 'border-emerald-200/80',
    hoverBorderColor: 'hover:border-emerald-400',
    dotGlow: 'shadow-[0_0_8px_rgba(34,197,94,0.6)]',
    label: 'Completed',
    badgeVariant: 'success' as const,
    icon: CheckCircle2,
  },
  BLOCKED: {
    color: 'text-rose-600',
    bgColor: 'bg-rose-500',
    borderColor: 'border-rose-200/80',
    hoverBorderColor: 'hover:border-rose-400',
    dotGlow: 'shadow-[0_0_8px_rgba(239,68,68,0.6)]',
    label: 'Blocked',
    badgeVariant: 'danger' as const,
    icon: AlertOctagon,
  },
};

const PRIORITY_CONFIG = {
  HIGH: {
    color: 'text-rose-700',
    bgColor: 'bg-rose-50 border-rose-200/80',
    label: 'High',
  },
  MEDIUM: {
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 border-amber-200/80',
    label: 'Medium',
  },
  LOW: {
    color: 'text-slate-700',
    bgColor: 'bg-slate-100 border-slate-200/80',
    label: 'Low',
  },
};

function getOwnerName(
  ownerId: string | undefined,
  users: Array<{ id: string; name: string; email: string }>
) {
  if (!ownerId) return 'Unassigned';
  const user = users.find(u => u.id === ownerId);
  return user?.name || 'Unknown';
}

function ActionItemCard({
  item,
  users,
  userTimeZone,
  canManage,
  onStatusChange,
  isUpdating = false,
}: ActionItemCardProps) {
  const router = useRouter();
  const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.OPEN;
  const priorityConfig = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.MEDIUM;

  return (
    <div
      className={cn(
        'group p-3.5 bg-white rounded-lg border shadow-sm transition-all duration-200',
        statusConfig.borderColor,
        statusConfig.hoverBorderColor,
        'hover:shadow-md hover:-translate-y-0.5 relative',
        isUpdating && 'opacity-60 pointer-events-none'
      )}
      onClick={() => router.push(`/postmortems/${item.incidentId}`)}
    >
      {/* Top Header: Priority & Quick Status Dropdown */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[11px] font-semibold border',
              priorityConfig.bgColor,
              priorityConfig.color
            )}
          >
            {priorityConfig.label}
          </span>
          <DueDateBadge
            dueDate={item.dueDate}
            completedAt={item.completedAt}
            status={item.status}
            userTimeZone={userTimeZone}
          />
        </div>

        {canManage && (
          <div onClick={e => e.stopPropagation()}>
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
              <DropdownMenuContent align="end" className="w-44 text-xs">
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
                  className="gap-2 text-emerald-600 focus:text-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Mark Completed</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onStatusChange(item.id, ActionItemStatus.BLOCKED)}
                  disabled={item.status === 'BLOCKED'}
                  className="gap-2 text-rose-600 focus:text-rose-700"
                >
                  <AlertOctagon className="h-3.5 w-3.5 text-rose-600" />
                  <span>Mark Blocked</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Title & Description */}
      <h4 className="text-sm font-semibold text-foreground mb-1 leading-snug line-clamp-2">
        {item.title}
      </h4>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2.5 leading-relaxed">
          {item.description}
        </p>
      )}

      {/* Jira / GitHub External Link */}
      <div className="mb-2.5">
        <ActionItemJiraBadge
          actionItemId={item.id}
          externalIssue={item.externalIssue}
          canManage={canManage}
          compact
        />
      </div>

      {/* Metadata Footer */}
      <div className="pt-2 border-t border-slate-100 flex flex-col gap-1 text-[11px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground truncate max-w-[150px]">
            👤 {getOwnerName(item.owner, users)}
          </span>
          <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-700 truncate max-w-[100px]">
            {item.serviceName}
          </span>
        </div>
        <div className="truncate text-slate-500">
          From{' '}
          <Link
            href={`/postmortems/${item.incidentId}`}
            className="hover:underline text-primary"
            onClick={e => e.stopPropagation()}
          >
            {item.incidentTitle}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ActionItemsBoard({
  actionItems: initialItems,
  users,
  canManage,
  view,
  filters,
}: ActionItemsBoardProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [, startTransition] = useTransition();

  const [items, setItems] = useState<BoardActionItem[]>(initialItems);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(filters.status || '');
  const [selectedOwner, setSelectedOwner] = useState(filters.owner || '');
  const [selectedPriority, setSelectedPriority] = useState(filters.priority || '');

  // Keep internal state in sync with server-passed props
  useMemo(() => {
    setItems(initialItems);
  }, [initialItems]);

  const handleStatusChange = async (itemId: string, newStatus: ActionItemStatus) => {
    // Optimistic UI update
    setItems(prev =>
      prev.map(it =>
        it.id === itemId
          ? {
              ...it,
              status: newStatus,
              completedAt: newStatus === ActionItemStatus.COMPLETED ? new Date() : null,
            }
          : it
      )
    );

    setUpdatingId(itemId);
    try {
      const res = await updateActionItemStatus(itemId, newStatus);
      if (!res.success) {
        // Rollback if failed
        setItems(initialItems);
      }
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
  }) => {
    const params = new URLSearchParams();
    const targetStatus = updates.status !== undefined ? updates.status : selectedStatus;
    const targetOwner = updates.owner !== undefined ? updates.owner : selectedOwner;
    const targetPriority = updates.priority !== undefined ? updates.priority : selectedPriority;
    const targetView = updates.view !== undefined ? updates.view : view;

    if (targetStatus && targetStatus !== 'all') params.set('status', targetStatus);
    if (targetOwner && targetOwner !== 'all') params.set('owner', targetOwner);
    if (targetPriority && targetPriority !== 'all') params.set('priority', targetPriority);
    if (targetView) params.set('view', targetView);

    return `/action-items?${params.toString()}`;
  };

  const filteredItems = useMemo(() => {
    let result = items;

    if (selectedStatus && selectedStatus !== 'all') {
      result = result.filter(item => item.status === selectedStatus);
    }

    if (selectedOwner && selectedOwner !== 'all') {
      result = result.filter(item => item.owner === selectedOwner);
    }

    if (selectedPriority && selectedPriority !== 'all') {
      result = result.filter(item => item.priority === selectedPriority);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(item => {
        const ownerName = getOwnerName(item.owner, users).toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q)) ||
          item.incidentTitle.toLowerCase().includes(q) ||
          item.serviceName.toLowerCase().includes(q) ||
          ownerName.includes(q)
        );
      });
    }

    return result;
  }, [items, search, selectedStatus, selectedOwner, selectedPriority, users]);

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
        { header: 'Owner', accessor: row => getOwnerName(row.owner, users) },
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
    startTransition(() => router.push('/action-items'));
  };

  return (
    <div className="space-y-4">
      {/* Unified Search & Filter Toolbar */}
      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search action items, postmortems, owners..."
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleReset}
        filters={
          <>
            <Select
              value={selectedStatus || 'all'}
              onValueChange={value => {
                const newValue = value === 'all' ? '' : value;
                setSelectedStatus(newValue);
                startTransition(() => router.push(buildFilterUrl({ status: newValue })));
              }}
            >
              <SelectTrigger className="h-9 w-[130px] bg-slate-50/60 text-xs">
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

            <Select
              value={selectedOwner || 'all'}
              onValueChange={value => {
                const newValue = value === 'all' ? '' : value;
                setSelectedOwner(newValue);
                startTransition(() => router.push(buildFilterUrl({ owner: newValue })));
              }}
            >
              <SelectTrigger className="h-9 w-[140px] bg-slate-50/60 text-xs">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Owners</SelectItem>
                {users.map(user => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedPriority || 'all'}
              onValueChange={value => {
                const newValue = value === 'all' ? '' : value;
                setSelectedPriority(newValue);
                startTransition(() => router.push(buildFilterUrl({ priority: newValue })));
              }}
            >
              <SelectTrigger className="h-9 w-[130px] bg-slate-50/60 text-xs">
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
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50/60 p-0.5">
              <Link
                href={buildFilterUrl({ view: 'board' })}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all',
                  view === 'board'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-label="Board view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Board</span>
              </Link>
              <Link
                href={buildFilterUrl({ view: 'list' })}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all',
                  view === 'list'
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-label="List view"
              >
                <List className="h-3.5 w-3.5" />
                <span>List</span>
              </Link>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredItems.length === 0}
              className="h-9 gap-1.5 text-xs shadow-sm hover:bg-slate-100"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Export CSV</span>
            </Button>
          </div>
        }
      />

      {/* Board or List View */}
      {view === 'board' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(groupedByStatus).map(([status, groupItems]) => {
            const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
            const StatusIcon = config.icon;

            return (
              <Card
                key={status}
                className={cn(
                  'p-3.5 min-h-[480px] rounded-xl flex flex-col',
                  'bg-slate-50/50 border-2',
                  config.borderColor,
                  'shadow-sm'
                )}
              >
                <CardHeader className="p-0 mb-3 pb-2.5 border-b border-slate-200/70">
                  <div className="flex items-center justify-between">
                    <h3 className={cn('text-xs font-bold flex items-center gap-1.5', config.color)}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      <span>{config.label}</span>
                    </h3>
                    <Badge variant={config.badgeVariant} size="xs" className="font-bold">
                      {groupItems.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex flex-col gap-2.5 flex-1 overflow-y-auto max-h-[75vh]">
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
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredItems.length === 0 ? (
            <Card className="p-8 text-center bg-white border-slate-200 rounded-lg shadow-sm">
              <EmptyState
                icon={<LayoutGrid className="h-6 w-6 text-muted-foreground/60" />}
                title="No action items found"
                description={
                  hasActiveFilters
                    ? 'Try clearing or modifying your filter criteria.'
                    : 'Preventative action items from postmortems will appear here.'
                }
              />
            </Card>
          ) : (
            filteredItems.map(item => {
              const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.OPEN;
              const priorityConfig = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.MEDIUM;
              const isUpdating = updatingId === item.id;

              return (
                <Card
                  key={item.id}
                  className={cn(
                    'p-4 rounded-lg cursor-pointer shadow-sm bg-white',
                    'border-2 border-l-4 transition-all duration-200 ease-out',
                    statusConfig.borderColor,
                    'hover:shadow-md hover:translate-x-0.5',
                    isUpdating && 'opacity-60 pointer-events-none'
                  )}
                  onClick={() => router.push(`/postmortems/${item.incidentId}`)}
                >
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge
                          variant={statusConfig.badgeVariant}
                          size="xs"
                          className="font-semibold"
                        >
                          {statusConfig.label}
                        </Badge>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold border',
                            priorityConfig.bgColor,
                            priorityConfig.color
                          )}
                        >
                          {priorityConfig.label} Priority
                        </span>
                        <DueDateBadge
                          dueDate={item.dueDate}
                          completedAt={item.completedAt}
                          status={item.status}
                          userTimeZone={userTimeZone}
                        />
                      </div>
                      <h3 className="text-base font-semibold mb-1 text-foreground">{item.title}</h3>
                      <ActionItemJiraBadge
                        actionItemId={item.id}
                        externalIssue={item.externalIssue}
                        canManage={canManage}
                        compact
                      />
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1 mb-2">
                          {item.description}
                        </p>
                      )}
                    </div>

                    {canManage && (
                      <div onClick={e => e.stopPropagation()} className="shrink-0">
                        <Select
                          value={item.status}
                          onValueChange={val =>
                            handleStatusChange(item.id, val as ActionItemStatus)
                          }
                        >
                          <SelectTrigger className="h-8 w-[130px] text-xs bg-slate-50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="OPEN">Open</SelectItem>
                            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                            <SelectItem value="COMPLETED">Completed</SelectItem>
                            <SelectItem value="BLOCKED">Blocked</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4 pt-2.5 border-t border-slate-100 text-xs text-muted-foreground flex-wrap items-center">
                    <span>👤 {getOwnerName(item.owner, users)}</span>
                    <span>
                      📋{' '}
                      <Link
                        href={`/postmortems/${item.incidentId}`}
                        className="text-primary hover:underline font-medium"
                        onClick={e => e.stopPropagation()}
                      >
                        {item.postmortemTitle}
                      </Link>
                    </span>
                    <span>
                      🔗{' '}
                      <Link
                        href={`/incidents/${item.incidentId}`}
                        className="text-primary hover:underline font-medium"
                        onClick={e => e.stopPropagation()}
                      >
                        {item.incidentTitle}
                      </Link>
                    </span>
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] font-mono text-slate-700">
                      {item.serviceName}
                    </span>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
