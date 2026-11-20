'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';

import Pagination from '@/components/incident/Pagination';
import EmptyState from '@/components/ui/EmptyState';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  RelativeTime,
  SeverityBadge,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns';
import { notify } from '@/lib/toast';
import {
  MoreHorizontal,
  FileText,
  CheckCircle2,
  Eye,
  Edit2,
  Globe,
  Lock,
  Trash2,
  Loader2,
  ListChecks,
  AlertTriangle,
} from 'lucide-react';
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
    urgency?: string | null;
    priority?: string | null;
    resolvedAt: Date | null;
    service: {
      id: string;
      name: string;
    };
  };
  _count?: { actionItemRecords: number };
};

type PostmortemsListTableProps = {
  postmortems: PostmortemListItem[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  canManage: boolean;
};

function Visibility({ isPublic }: { isPublic: boolean | null }) {
  return isPublic ? (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      title="Publicly visible"
    >
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      Public
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground/70"
      title="Internal only"
    >
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      Private
    </span>
  );
}

/** Linked incident, its service, and a resolved check: the primary cell's second line. */
function IncidentLine({ pm }: { pm: PostmortemListItem }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        href={`/incidents/${pm.incidentId}`}
        className="truncate hover:text-primary hover:underline"
        title={pm.incident.title}
      >
        {pm.incident.title}
      </Link>
      <span aria-hidden="true">·</span>
      <span className="shrink-0 font-medium">{pm.incident.service.name}</span>
      {pm.incident.status === 'RESOLVED' && (
        <span className="flex shrink-0 items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Resolved
        </span>
      )}
    </span>
  );
}

function Author({ pm }: { pm: PostmortemListItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <UserAvatar
        userId={pm.createdBy?.id || 'unknown'}
        name={pm.createdBy?.name}
        avatarUrl={pm.createdBy?.avatarUrl}
        size="sm"
        aria-hidden
      />
      <span className="truncate text-xs text-foreground">
        {pm.createdBy?.name || pm.createdBy?.email || 'Unknown'}
      </span>
    </div>
  );
}

function ActionItemCount({ pm }: { pm: PostmortemListItem }) {
  const count = pm._count?.actionItemRecords ?? 0;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
      title={`${count} action item${count === 1 ? '' : 's'}`}
    >
      <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
      {count}
    </span>
  );
}

const GUIDE_STEPS = [
  {
    title: 'Start from a resolved incident',
    description: 'Each resolved incident can have one postmortem. It starts as a draft.',
  },
  {
    title: 'Capture what happened',
    description: 'Record the timeline, impact, contributing factors, root cause and resolution.',
  },
  {
    title: 'Add action items',
    description:
      'Give each follow-up an owner, priority and due date. They’re tracked on the Action Items board.',
  },
  {
    title: 'Publish',
    description:
      'Publish once reviewed. Public postmortems also appear on your status page; internal ones stay private.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'Incidents',
    href: '/incidents',
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'Action Items',
    href: '/action-items',
    icon: <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

export default function PostmortemsListTable({
  postmortems,
  pagination,
  canManage,
}: PostmortemsListTableProps) {
  const router = useRouter();
  const [view, setView] = useDirectoryView('postmortems');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'bulk'; ids: string[] } | { kind: 'single'; incidentId: string } | null
  >(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const allSelected = postmortems.length > 0 && selectedIds.length === postmortems.length;

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? postmortems.map(pm => pm.id) : []);
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter(item => item !== id)
    );
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

  const rowMenu = (pm: PostmortemListItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Actions for {pm.title}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/postmortems/${pm.incidentId}`)}>
          <Eye />
          View
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={() => router.push(`/postmortems/${pm.incidentId}`)}>
              <Edit2 />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => handleDeleteSingle(pm.incidentId)}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: DirectoryColumn<PostmortemListItem>[] = [
    {
      id: 'title',
      header: 'Postmortem',
      // max-w-0 + w-full: take the spare width and truncate instead of pushing columns off-screen.
      className: 'w-full max-w-0',
      cell: pm => (
        <DirectoryPrimaryCell
          href={`/postmortems/${pm.incidentId}`}
          title={<span title={`${pm.title} (ID: ${pm.id})`}>{pm.title}</span>}
          subtitle={<IncidentLine pm={pm} />}
        />
      ),
    },
    {
      id: 'status',
      hideable: true,
      header: 'Status',
      className: 'w-32',
      cell: pm => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge status={pm.status} size="sm" showDot />
          <Visibility isPublic={pm.isPublic} />
        </div>
      ),
    },
    {
      id: 'author',
      hideable: true,
      header: 'Author',
      className: 'hidden w-40 lg:table-cell',
      cell: pm => (
        <div className="max-w-40">
          <Author pm={pm} />
        </div>
      ),
    },
    {
      id: 'severity',
      hideable: true,
      header: 'Severity',
      className: 'hidden w-24 md:table-cell',
      cell: pm =>
        pm.incident.urgency || pm.incident.priority ? (
          <SeverityBadge
            urgency={pm.incident.urgency}
            priority={pm.incident.priority}
            size="xs"
            abbreviate
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'date',
      hideable: true,
      header: 'Created',
      className: 'w-24',
      cell: pm => <RelativeTime date={pm.createdAt} className="text-xs text-muted-foreground" />,
    },
    {
      id: 'actions',
      hideable: true,
      header: 'Items',
      className: 'hidden w-16 xl:table-cell',
      cell: pm => <ActionItemCount pm={pm} />,
    },
  ];

  const columnVisibility = useDirectoryColumns('postmortems', columns);

  if (postmortems.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-6 w-6 text-muted-foreground/60" />}
        title="No postmortems found"
        description="Try adjusting your filters or create a new postmortem report."
        size="md"
      />
    );
  }
  const rangeStart = (pagination.currentPage - 1) * pagination.itemsPerPage + 1;

  return (
    <div className="space-y-4">
      {/* Bulk Action Bar */}
      {canManage && selectedIds.length > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-900 transition-all dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span>{selectedIds.length} postmortem(s) selected</span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 shadow-sm"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Selected ({selectedIds.length})
          </Button>
        </div>
      )}

      <div className="overflow-clip rounded-lg border border-border bg-card">
        <DirectoryHeader
          title="Postmortems"
          summary={`Showing ${rangeStart}–${rangeStart + postmortems.length - 1} of ${pagination.totalItems}`}
          selectAll={
            canManage
              ? {
                  checked: allSelected,
                  indeterminate: selectedIds.length > 0 && !allSelected,
                  onCheckedChange: toggleSelectAll,
                  label: 'Select all',
                }
              : undefined
          }
          columns={columnVisibility}
          density
          view={{ value: view, onChange: setView }}
          guide={
            <DirectoryGuide title="How postmortems work" steps={GUIDE_STEPS} links={GUIDE_LINKS} />
          }
        />

        {view === 'cards' ? (
          <DirectoryCardGrid>
            {postmortems.map(pm => (
              <Card key={pm.id} className="border-border bg-card">
                <CardContent className="space-y-2 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                      <DirectoryPrimaryCell
                        href={`/postmortems/${pm.incidentId}`}
                        title={<span title={`${pm.title} (ID: ${pm.id})`}>{pm.title}</span>}
                        subtitle={<IncidentLine pm={pm} />}
                      />
                    </div>
                    {rowMenu(pm)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={pm.status} size="sm" showDot />
                    <SeverityBadge
                      urgency={pm.incident.urgency}
                      priority={pm.incident.priority}
                      size="xs"
                      abbreviate
                    />
                    <Visibility isPublic={pm.isPublic} />
                    <ActionItemCount pm={pm} />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                    <Author pm={pm} />
                    <RelativeTime
                      date={pm.createdAt}
                      className="shrink-0 text-xs text-muted-foreground"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </DirectoryCardGrid>
        ) : (
          <DirectoryTable
            label="Postmortems"
            rows={postmortems}
            getRowId={pm => pm.id}
            columns={columns}
            hiddenColumns={columnVisibility.hidden}
            selection={
              canManage
                ? {
                    selected: new Set(selectedIds),
                    onToggle: toggleSelect,
                    rowLabel: pm => `Select ${pm.title}`,
                  }
                : undefined
            }
            rowActions={rowMenu}
            mobileRow={pm => (
              <div className="min-w-0 space-y-1">
                <DirectoryPrimaryCell
                  href={`/postmortems/${pm.incidentId}`}
                  title={pm.title}
                  subtitle={pm.incident.title}
                />
                <div className="flex items-center gap-2">
                  <StatusBadge status={pm.status} size="sm" showDot />
                  <RelativeTime date={pm.createdAt} className="text-xs text-muted-foreground" />
                </div>
              </div>
            )}
          />
        )}

        {/* Pagination (the header summary already covers a single page) */}
        {pagination.totalPages > 1 && (
          <div className="border-t border-border px-4 py-3">
            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalItems}
              itemsPerPage={pagination.itemsPerPage}
              itemLabel="postmortem"
            />
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={pendingDelete?.kind === 'bulk' ? 'Delete postmortems' : 'Delete postmortem'}
        description={
          pendingDelete?.kind === 'bulk'
            ? `Are you sure you want to delete ${pendingDelete.ids.length} selected postmortem(s)? This action cannot be undone.`
            : 'Are you sure you want to delete this postmortem draft?'
        }
        onConfirm={confirmPendingDelete}
      />
    </div>
  );
}
