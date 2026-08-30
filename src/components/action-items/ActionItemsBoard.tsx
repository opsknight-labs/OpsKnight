'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
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
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import type { ActionItem } from '@/lib/action-items';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import { exportToCsv } from '@/lib/export-csv';
import { Download, LayoutGrid, List } from 'lucide-react';

interface BoardActionItem extends ActionItem {
  postmortemId: string;
  postmortemTitle: string;
  incidentId: string;
  incidentTitle: string;
  serviceName: string;
  createdAt: Date;
}

interface ActionItemsBoardProps {
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
}

const STATUS_CONFIG = {
  OPEN: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-500',
    borderColor: 'border-blue-500/40',
    hoverBorderColor: 'hover:border-blue-500/60',
    dotGlow: 'shadow-[0_0_8px_rgba(59,130,246,0.6)]',
    label: 'Open',
    badgeVariant: 'info' as const,
  },
  IN_PROGRESS: {
    color: 'text-amber-500',
    bgColor: 'bg-amber-500',
    borderColor: 'border-amber-500/40',
    hoverBorderColor: 'hover:border-amber-500/60',
    dotGlow: 'shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    label: 'In Progress',
    badgeVariant: 'warning' as const,
  },
  COMPLETED: {
    color: 'text-green-500',
    bgColor: 'bg-green-500',
    borderColor: 'border-green-500/40',
    hoverBorderColor: 'hover:border-green-500/60',
    dotGlow: 'shadow-[0_0_8px_rgba(34,197,94,0.6)]',
    label: 'Completed',
    badgeVariant: 'success' as const,
  },
  BLOCKED: {
    color: 'text-red-500',
    bgColor: 'bg-red-500',
    borderColor: 'border-red-500/40',
    hoverBorderColor: 'hover:border-red-500/60',
    dotGlow: 'shadow-[0_0_8px_rgba(239,68,68,0.6)]',
    label: 'Blocked',
    badgeVariant: 'danger' as const,
  },
};

const PRIORITY_CONFIG = {
  HIGH: {
    color: 'text-red-500',
    bgColor: 'bg-red-500/20',
    label: 'High',
  },
  MEDIUM: {
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/20',
    label: 'Medium',
  },
  LOW: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/20',
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

function isOverdue(item: ActionItem) {
  if (!item.dueDate || item.status === 'COMPLETED') return false;
  return new Date(item.dueDate) < new Date();
}

function ActionItemCard({ item, users, userTimeZone, canManage }: ActionItemCardProps) {
  const overdue = isOverdue(item);
  const statusConfig = STATUS_CONFIG[item.status];
  const priorityConfig = PRIORITY_CONFIG[item.priority];

  return (
    <div
      className={cn(
        'p-4 bg-white rounded-md cursor-pointer',
        'border-2 border-l-4',
        statusConfig.borderColor,
        'transition-all duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-lg'
      )}
      onClick={() => (window.location.href = `/postmortems/${item.incidentId}`)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-semibold',
                priorityConfig.bgColor,
                priorityConfig.color
              )}
            >
              {priorityConfig.label}
            </span>
            {overdue && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-500">
                Overdue
              </span>
            )}
          </div>
          <h4 className="text-base font-semibold mb-1">{item.title}</h4>
          <ActionItemJiraBadge
            actionItemId={item.id}
            externalIssue={item.externalIssue}
            canManage={canManage}
            compact
          />
          {item.description && (
            <p className="text-sm text-muted-foreground mb-2">
              {item.description.substring(0, 100)}
              {item.description.length > 100 ? '...' : ''}
            </p>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <div>👤 {getOwnerName(item.owner, users)}</div>
        {item.dueDate && (
          <div>📅 {formatDateTime(item.dueDate, userTimeZone, { format: 'date' })}</div>
        )}
        <div>
          📋{' '}
          <Link href={`/postmortems/${item.incidentId}`} className="text-primary hover:underline">
            {item.postmortemTitle}
          </Link>
        </div>
        <div className="text-[0.7rem] mt-1">Incident: {item.incidentTitle}</div>
      </div>
    </div>
  );
}

export default function ActionItemsBoard({
  actionItems,
  users,
  canManage,
  view,
  filters,
}: ActionItemsBoardProps) {
  const { userTimeZone } = useTimezone();
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState(filters.status || '');
  const [selectedOwner, setSelectedOwner] = useState(filters.owner || '');
  const [selectedPriority, setSelectedPriority] = useState(filters.priority || '');

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
    if (!search.trim()) return actionItems;
    const q = search.toLowerCase();
    return actionItems.filter(item => {
      const ownerName = getOwnerName(item.owner, users).toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        item.incidentTitle.toLowerCase().includes(q) ||
        item.serviceName.toLowerCase().includes(q) ||
        ownerName.includes(q)
      );
    });
  }, [actionItems, search, users]);

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
    window.location.href = '/action-items';
  };

  return (
    <div className="space-y-4">
      {/* Unified Search & Filter Toolbar */}
      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search action items, descriptions, owners..."
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleReset}
        filters={
          <>
            <Select
              value={selectedStatus || 'all'}
              onValueChange={value => {
                const newValue = value === 'all' ? '' : value;
                setSelectedStatus(newValue);
                window.location.href = buildFilterUrl({ status: newValue });
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
                window.location.href = buildFilterUrl({ owner: newValue });
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
                window.location.href = buildFilterUrl({ priority: newValue });
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
          {Object.entries(groupedByStatus).map(([status, items]) => {
            const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
            return (
              <Card
                key={status}
                className={cn(
                  'p-4 min-h-[450px] rounded-xl',
                  'bg-gradient-to-br from-white to-slate-50',
                  'border-2',
                  config.borderColor,
                  'shadow-sm'
                )}
              >
                <CardHeader className="p-0 mb-4 pb-3 border-b border-slate-200/60">
                  <div className="flex items-center justify-between">
                    <h3 className={cn('text-sm font-bold flex items-center gap-2', config.color)}>
                      <span
                        className={cn('w-2 h-2 rounded-full', config.bgColor, config.dotGlow)}
                      />
                      {config.label}
                    </h3>
                    <Badge variant={config.badgeVariant} size="xs" className="font-bold">
                      {items.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex flex-col gap-3">
                  {items.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground text-xs italic">
                      No items
                    </div>
                  ) : (
                    items.map(item => (
                      <ActionItemCard
                        key={item.id}
                        item={item}
                        users={users}
                        userTimeZone={userTimeZone}
                        canManage={canManage}
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
            <Card className="p-8 text-center bg-gradient-to-br from-white to-slate-50 border-slate-200 rounded-lg shadow-sm">
              <p className="text-sm text-muted-foreground">
                No action items found matching the filters.
              </p>
            </Card>
          ) : (
            filteredItems.map(item => {
              const overdue = isOverdue(item);
              const statusConfig = STATUS_CONFIG[item.status];
              const priorityConfig = PRIORITY_CONFIG[item.priority];

              return (
                <Card
                  key={item.id}
                  className={cn(
                    'p-4 rounded-lg cursor-pointer shadow-sm',
                    'bg-gradient-to-br from-white to-slate-50',
                    'border-2 border-l-4',
                    statusConfig.borderColor,
                    'transition-all duration-200 ease-out',
                    'hover:translate-x-1 hover:shadow-md'
                  )}
                  onClick={() => (window.location.href = `/postmortems/${item.incidentId}`)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge
                          variant={statusConfig.badgeVariant}
                          size="xs"
                          className="font-semibold"
                        >
                          {statusConfig.label}
                        </Badge>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold',
                            priorityConfig.bgColor,
                            priorityConfig.color
                          )}
                        >
                          {priorityConfig.label} Priority
                        </span>
                        {overdue && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-500">
                            Overdue
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold mb-1">{item.title}</h3>
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
                  </div>
                  <div className="flex gap-4 pt-2.5 border-t border-slate-200 text-xs text-muted-foreground flex-wrap">
                    <span>👤 {getOwnerName(item.owner, users)}</span>
                    {item.dueDate && (
                      <span>
                        📅 Due: {formatDateTime(item.dueDate, userTimeZone, { format: 'date' })}
                      </span>
                    )}
                    <span>
                      📋{' '}
                      <Link
                        href={`/postmortems/${item.incidentId}`}
                        className="text-primary hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {item.postmortemTitle}
                      </Link>
                    </span>
                    <span>
                      🔗{' '}
                      <Link
                        href={`/incidents/${item.incidentId}`}
                        className="text-primary hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {item.incidentTitle}
                      </Link>
                    </span>
                    <span>🏷️ {item.serviceName}</span>
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
