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
import { FilterBar, FilterField } from '@/components/patterns';
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
  const [, startTransition] = useTransition();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'ALL') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page'); // Reset to page 1

    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/postmortems?${qs}` : '/postmortems');
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
    <FilterBar
      search={{
        value: currentSearch,
        onChange: val => updateParam('search', val),
        placeholder: 'Search postmortems, incidents or services…',
        label: 'Search postmortems',
        debounceMs: 300,
      }}
      hasActiveFilters={hasActiveFilters}
      onClearAll={handleReset}
      filters={
        <>
          <FilterField label="Status" htmlFor="postmortem-filter-status">
            <Select
              value={currentStatus || 'ALL'}
              onValueChange={val => updateParam('status', val)}
            >
              <SelectTrigger
                id="postmortem-filter-status"
                className="h-9 w-full bg-background text-sm"
              >
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>

          {services.length > 0 && (
            <FilterField label="Service" htmlFor="postmortem-filter-service">
              <Select
                value={currentServiceId || 'ALL'}
                onValueChange={val => updateParam('serviceId', val)}
              >
                <SelectTrigger
                  id="postmortem-filter-service"
                  className="h-9 w-full bg-background text-sm"
                >
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All services</SelectItem>
                  {services.map(svc => (
                    <SelectItem key={svc.id} value={svc.id}>
                      {svc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          )}
        </>
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={postmortemsData.length === 0}
          className="h-9"
        >
          <Download aria-hidden="true" />
          Export CSV
        </Button>
      }
    />
  );
}
