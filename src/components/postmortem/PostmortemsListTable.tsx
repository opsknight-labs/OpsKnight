'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';

import Pagination from '@/components/incident/Pagination';
import {
  EmptyState,
  RelativeTime,
  StatusBadge as IncidentStatusBadge,
} from '@/components/patterns';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { notify } from '@/lib/toast';
import { MoreHorizontal, FileText, SearchX, Eye, Edit2, Globe, Lock, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import UserAvatar from '@/components/UserAvatar';
import StatusBadge from '@/components/incident/StatusBadge';
import { deletePostmortem, bulkDeletePostmortems } from '@/app/(app)/postmortems/actions';

type PostmortemListItem = {
  id: string;
  title: string;
  status: string;
  isPublic: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  incidentId: string;
  createdBy: {
    id: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  } | null;
  incident: {
    id: string;
    title: string;
    status: string;
    resolvedAt: Date | null;
    service: {
      id: string;
      name: string;
    };
  };
};

type PostmortemsListTableProps = {
  postmortems: PostmortemListItem[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  /** Kept for API compatibility; timestamps use the viewer's timezone from context. */
  userTimeZone?: string;
  canManage: boolean;
  /** Filters/search narrow the list; switches the empty state to "Clear filters". */
  hasFilters?: boolean;
  /** Next action for the first-run empty state (e.g. "Create postmortem"). */
  createAction?: ReactNode;
};

export default function PostmortemsListTable({
  postmortems,
  pagination,
  canManage,
  hasFilters = false,
  createAction,
}: PostmortemsListTableProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'bulk'; ids: string[] } | { kind: 'single'; incidentId: string } | null
  >(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const allSelected = postmortems.length > 0 && selectedIds.length === postmortems.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(postmortems.map(pm => pm.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    setPendingDelete({ kind: 'bulk', ids: selectedIds });
    setDeleteDialogOpen(true);
  };

  const handleDeleteSingle = (incidentId: string) => {
    setPendingDelete({ kind: 'single', incidentId });
    setDeleteDialogOpen(true);
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;

    if (pendingDelete.kind === 'bulk') {
      setIsDeleting(true);
      try {
        await bulkDeletePostmortems(pendingDelete.ids);
        setSelectedIds([]);
        router.refresh();
      } catch (err) {
        notify.error(err instanceof Error ? err.message : 'Failed to delete postmortems');
      } finally {
        setIsDeleting(false);
      }
      return;
    }

    const { incidentId } = pendingDelete;
    try {
      await deletePostmortem(incidentId);
      setSelectedIds(prev => prev.filter(id => id !== incidentId));
      router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to delete postmortem');
    }
  };

  if (postmortems.length === 0) {
    return hasFilters ? (
      <EmptyState
        icon={<SearchX />}
        title="No postmortems match these filters"
        description="Try another search term, or widen the status and service filters."
        primaryAction={
          <Button variant="outline" size="sm" onClick={() => router.push('/postmortems')}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<FileText />}
        title="No postmortems yet"
        description="A postmortem records what happened during a resolved incident, why, and the action items that stop it from happening again. Start one from any resolved incident."
        primaryAction={createAction}
      />
    );
  }

  const rowMenu = (pm: PostmortemListItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-icon-button=""
          aria-label={`Actions for ${pm.title}`}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/postmortems/${pm.incidentId}`}>
            <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
            View postmortem
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/incidents/${pm.incidentId}`}>
            <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
            Open incident
          </Link>
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem asChild>
              <Link href={`/postmortems/${pm.incidentId}?edit=true`}>
                <Edit2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDeleteSingle(pm.incidentId)}
              className="text-rose-600 focus:bg-rose-50 focus:text-rose-600 dark:text-rose-400 dark:focus:bg-rose-500/10 dark:focus:text-rose-400"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const visibility = (pm: PostmortemListItem) =>
    pm.isPublic ? (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        Public
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        Internal
      </span>
    );

  return (
    <div className="space-y-4">
      {canManage && selectedIds.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm"
        >
          <span className="text-sm font-medium tabular-nums text-foreground">
            {selectedIds.length} selected
          </span>
          <Button variant="destructive" size="sm" onClick={handleBulkDelete} loading={isDeleting}>
            <Trash2 aria-hidden="true" />
            Delete selected
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {/* Phones get a card list instead of a horizontally scrolling table. */}
        <ul className="divide-y divide-border md:hidden">
          {postmortems.map(pm => (
            <li key={pm.id} className="flex items-start gap-3 px-4 py-3.5">
              {canManage && (
                <Checkbox
                  data-icon-button=""
                  className="mt-1"
                  checked={selectedIds.includes(pm.id)}
                  onCheckedChange={() => toggleSelect(pm.id)}
                  aria-label={`Select ${pm.title}`}
                />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <Link
                  href={`/postmortems/${pm.incidentId}`}
                  className="block rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {pm.title}
                </Link>
                <Link
                  href={`/incidents/${pm.incidentId}`}
                  className="block truncate rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Incident: {pm.incident.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={pm.status} size="sm" showDot />
                  {visibility(pm)}
                  <RelativeTime date={pm.createdAt} />
                </div>
              </div>
              {rowMenu(pm)}
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
              {/* Overrides the legacy global `table th` uppercase/800 rule. */}
              <tr className="[&>th]:font-medium [&>th]:normal-case [&>th]:tracking-normal">
                {canManage && (
                  <th scope="col" className="w-10 px-4 py-3">
                    <Checkbox
                      data-icon-button=""
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all postmortems on this page"
                    />
                  </th>
                )}
                <th scope="col" className="min-w-[200px] px-4 py-3 font-medium">
                  Postmortem
                </th>
                <th scope="col" className="min-w-[220px] px-4 py-3 font-medium">
                  Incident
                </th>
                <th scope="col" className="w-[120px] px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="w-[110px] px-4 py-3 font-medium">
                  Visibility
                </th>
                <th scope="col" className="w-[160px] px-4 py-3 font-medium">
                  Author
                </th>
                <th scope="col" className="w-[110px] px-4 py-3 font-medium">
                  Created
                </th>
                <th scope="col" className="w-[56px] px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {postmortems.map(pm => {
                const isSelected = selectedIds.includes(pm.id);

                return (
                  <tr
                    key={pm.id}
                    className={cn(
                      'transition-colors duration-150',
                      isSelected ? 'bg-muted/70' : 'hover:bg-muted/50'
                    )}
                  >
                    {canManage && (
                      <td className="px-4 py-3">
                        <Checkbox
                          data-icon-button=""
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(pm.id)}
                          aria-label={`Select ${pm.title}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link
                        href={`/postmortems/${pm.incidentId}`}
                        className="rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {pm.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/incidents/${pm.incidentId}`}
                        className="block max-w-[260px] truncate rounded-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={pm.incident.title}
                      >
                        {pm.incident.title}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <IncidentStatusBadge status={pm.incident.status} size="xs" />
                        <span className="truncate">{pm.incident.service.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={pm.status} size="sm" showDot />
                    </td>
                    <td className="px-4 py-3">{visibility(pm)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          userId={pm.createdBy?.id || 'unknown'}
                          name={pm.createdBy?.name}
                          avatarUrl={pm.createdBy?.avatarUrl}
                          size="sm"
                        />
                        <span className="max-w-[110px] truncate text-xs text-foreground">
                          {pm.createdBy?.name || pm.createdBy?.email || 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <RelativeTime date={pm.createdAt} />
                    </td>
                    <td className="px-4 py-3 text-right">{rowMenu(pm)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            itemsPerPage={pagination.itemsPerPage}
            itemLabel="postmortem"
          />
        </div>
      </div>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={pendingDelete?.kind === 'bulk' ? 'Delete postmortems' : 'Delete postmortem'}
        description={
          pendingDelete?.kind === 'bulk'
            ? `Delete ${pendingDelete.ids.length} selected ${pendingDelete.ids.length === 1 ? 'postmortem' : 'postmortems'}? This cannot be undone.`
            : 'Delete this postmortem? This cannot be undone.'
        }
        onConfirm={confirmPendingDelete}
      />
    </div>
  );
}
