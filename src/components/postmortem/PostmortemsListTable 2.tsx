'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';

import Pagination from '@/components/incident/Pagination';
import { MoreHorizontal, FileText, CheckCircle2, Eye, Edit2, Globe, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import UserAvatar from '@/components/UserAvatar';
import StatusBadge from '@/components/incident/StatusBadge';

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
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold">
              <tr>
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
                return (
                  <tr
                    key={pm.id}
                    className="group hover:bg-slate-50/80 transition-colors cursor-pointer"
                    onClick={() => router.push(`/postmortems/${pm.incidentId}`)}
                  >
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
                        <UserAvatar userId={pm.createdBy.id} name={pm.createdBy.name} size="sm" />
                        <span className="text-slate-700 truncate max-w-[100px]">
                          {pm.createdBy.name || pm.createdBy.email}
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
                            <DropdownMenuItem
                              onClick={() => router.push(`/postmortems/${pm.incidentId}`)}
                            >
                              <Edit2 className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
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
