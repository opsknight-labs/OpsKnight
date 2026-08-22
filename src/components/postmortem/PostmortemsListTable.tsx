'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';

import Pagination from '@/components/incident/Pagination';
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
  };
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
  userTimeZone: string;
  canManage: boolean;
};

export default function PostmortemsListTable({
  postmortems,
  pagination,
  userTimeZone,
  canManage,
}: PostmortemsListTableProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const allSelected = postmortems.length > 0 && selectedIds.length === postmortems.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(postmortems.map(pm => pm.id));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (
      !confirm(
        `Are you sure you want to delete ${selectedIds.length} selected postmortem(s)? This action cannot be undone.`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      await bulkDeletePostmortems(selectedIds);
      setSelectedIds([]);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete postmortems');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSingle = async (incidentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this postmortem draft?')) return;

    try {
      await deletePostmortem(incidentId);
      setSelectedIds(prev => prev.filter(id => id !== incidentId));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete postmortem');
    }
  };

  if (postmortems.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-4">
          <FileText className="h-6 w-6 text-slate-400" />
        </div>
        <h3 className="text-sm font-medium text-slate-900">No postmortems found</h3>
        <p className="mt-1 text-sm text-slate-500">
          Try adjusting your filters or create a new postmortem.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk Action Bar */}
      {canManage && selectedIds.length > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-900 transition-all">
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

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold">
              <tr>
                {canManage && (
                  <th className="px-4 py-3 w-[40px]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-4 py-3 min-w-[200px]">Postmortem</th>
                <th className="px-4 py-3 min-w-[200px]">Incident</th>
                <th className="px-4 py-3 w-[120px]">Status</th>
                <th className="px-4 py-3 w-[100px]">Visibility</th>
                <th className="px-4 py-3 w-[150px]">Author</th>
                <th className="px-4 py-3 w-[150px]">Date</th>
                <th className="px-4 py-3 w-[60px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {postmortems.map(pm => {
                const isSelected = selectedIds.includes(pm.id);

                return (
                  <tr
                    key={pm.id}
                    className={cn(
                      'group transition-colors cursor-pointer',
                      isSelected ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50/80'
                    )}
                    onClick={() => router.push(`/postmortems/${pm.incidentId}`)}
                  >
                    {canManage && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => toggleSelect(pm.id, e as any)}
                          className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 group-hover:text-primary transition-colors">
                        {pm.title}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 truncate max-w-[300px]">
                        ID: {pm.id.slice(0, 8)}...
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/incidents/${pm.incidentId}`}
                        className="font-medium text-slate-700 hover:text-primary hover:underline block truncate max-w-[200px]"
                        onClick={e => e.stopPropagation()}
                      >
                        {pm.incident.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5">
                        <span className="font-medium text-slate-600">
                          {pm.incident.service.name}
                        </span>
                        {pm.incident.status === 'RESOLVED' && (
                          <span className="text-emerald-600 flex items-center gap-0.5">
                            <CheckCircle2 className="h-3 w-3" /> Resolved
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={pm.status} size="sm" showDot />
                    </td>
                    <td className="px-4 py-3">
                      {pm.isPublic ? (
                        <div
                          className="flex items-center gap-1.5 text-slate-600"
                          title="Publicly visible"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">Public</span>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-1.5 text-slate-400"
                          title="Internal only"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          <span className="text-xs">Private</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          userId={pm.createdBy?.id || 'unknown'}
                          name={pm.createdBy?.name}
                          avatarUrl={pm.createdBy?.avatarUrl}
                          size="sm"
                        />
                        <span className="text-xs text-slate-700 truncate max-w-[100px]">
                          {pm.createdBy?.name || pm.createdBy?.email || 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">
                        {formatDateTime(pm.createdAt, userTimeZone, {
                          format: 'date',
                        })}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatDateTime(pm.createdAt, userTimeZone, {
                          format: 'time',
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4 text-slate-500" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => router.push(`/postmortems/${pm.incidentId}`)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </DropdownMenuItem>
                          {canManage && (
                            <>
                              <DropdownMenuItem
                                onClick={() => router.push(`/postmortems/${pm.incidentId}`)}
                              >
                                <Edit2 className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={e => handleDeleteSingle(pm.incidentId, e)}
                                className="text-red-600 focus:text-red-600 focus:bg-red-50"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="border-t border-slate-200 px-4 py-3 bg-slate-50/50">
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalItems={pagination.totalItems}
            itemsPerPage={pagination.itemsPerPage}
          />
        </div>
      </div>
    </div>
  );
}
