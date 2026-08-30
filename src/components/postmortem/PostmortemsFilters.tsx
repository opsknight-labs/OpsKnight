'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import { exportToCsv } from '@/lib/export-csv';
import { Download } from 'lucide-react';

export type PostmortemsFiltersProps = {
  currentStatus?: string;
  currentSearch?: string;
  currentServiceId?: string;
  services: Array<{ id: string; name: string }>;
  postmortemsData: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date | string;
    incident: {
      id: string;
      title: string;
      service: { name: string };
    };
    createdBy?: { name: string | null; email: string | null } | null;
  }>;
};

export default function PostmortemsFilters({
  currentStatus = 'ALL',
  currentSearch = '',
  currentServiceId = 'ALL',
  services = [],
  postmortemsData = [],
}: PostmortemsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'ALL') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page'); // Reset to page 1

    startTransition(() => {
      router.push(`/postmortems?${params.toString()}`);
    });
  };

  const hasActiveFilters =
    Boolean(currentStatus && currentStatus !== 'ALL') ||
    Boolean(currentSearch) ||
    Boolean(currentServiceId && currentServiceId !== 'ALL');

  const handleReset = () => {
    startTransition(() => {
      router.push('/postmortems');
    });
  };

  const handleExportCsv = () => {
    exportToCsv(
      `postmortems-export-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Postmortem ID', accessor: 'id' },
        { header: 'Title', accessor: 'title' },
        { header: 'Status', accessor: 'status' },
        { header: 'Incident ID', accessor: row => row.incident?.id ?? '' },
        { header: 'Incident Title', accessor: row => row.incident?.title ?? '' },
        { header: 'Service', accessor: row => row.incident?.service?.name ?? '' },
        {
          header: 'Author',
          accessor: row => row.createdBy?.name || row.createdBy?.email || 'System',
        },
        {
          header: 'Created At',
          accessor: row => new Date(row.createdAt).toISOString(),
        },
      ],
      postmortemsData
    );
  };

  return (
    <SearchFilterBar
      searchValue={currentSearch}
      onSearchChange={val => updateParam('search', val)}
      searchPlaceholder="Search postmortems, incidents, services..."
      hasActiveFilters={hasActiveFilters}
      onResetFilters={handleReset}
      filters={
        <>
          <Select value={currentStatus || 'ALL'} onValueChange={val => updateParam('status', val)}>
            <SelectTrigger className="h-9 w-[130px] bg-slate-50/60 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="DRAFT">Drafts</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
            </SelectContent>
          </Select>

          {services.length > 0 && (
            <Select
              value={currentServiceId || 'ALL'}
              onValueChange={val => updateParam('serviceId', val)}
            >
              <SelectTrigger className="h-9 w-[150px] bg-slate-50/60 text-xs">
                <SelectValue placeholder="Service" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Services</SelectItem>
                {services.map(svc => (
                  <SelectItem key={svc.id} value={svc.id}>
                    {svc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={postmortemsData.length === 0}
          className="h-9 gap-1.5 text-xs shadow-sm hover:bg-slate-100"
        >
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Export CSV</span>
        </Button>
      }
    />
  );
}
