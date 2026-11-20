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
import { AUDIT_ENTITY_TYPES } from '@/lib/audit-filters';

export type AuditFiltersProps = {
  currentEntityType?: string;
  currentAction?: string;
  currentSearch?: string;
  currentVia?: string;
  logsData?: Array<{
    id: string;
    createdAt: Date | string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    actor?: { name: string | null; email: string | null } | null;
    channel?: string | null;
    details?: string;
  }>;
};

export default function AuditFilters({
  currentEntityType = 'ALL',
  currentAction = '',
  currentSearch = '',
  currentVia = 'ALL',
  logsData = [],
}: AuditFiltersProps) {
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
    params.delete('page');

    startTransition(() => {
      router.push(`/audit?${params.toString()}`);
    });
  };

  const hasActiveFilters =
    (currentEntityType && currentEntityType !== 'ALL') ||
    Boolean(currentSearch) ||
    Boolean(currentAction) ||
    currentVia !== 'ALL';

  const handleReset = () => {
    startTransition(() => {
      router.push('/audit');
    });
  };

  const handleExportCsv = () => {
    exportToCsv(
      `audit-logs-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Audit ID', accessor: 'id' },
        { header: 'Timestamp', accessor: row => new Date(row.createdAt).toISOString() },
        { header: 'Actor Name', accessor: row => row.actor?.name || row.actorName || 'System' },
        { header: 'Actor Email', accessor: row => row.actor?.email || row.actorEmail || '-' },
        { header: 'Action', accessor: 'action' },
        { header: 'Entity Type', accessor: 'entityType' },
        { header: 'Entity ID', accessor: row => row.entityId || '-' },
        { header: 'Channel', accessor: row => row.channel || '' },
        {
          header: 'Details',
          accessor: row => (row.details === '-' ? '' : row.details || ''),
        },
      ],
      logsData
    );
  };

  return (
    <FilterBar
      search={{
        value: currentSearch,
        onChange: val => updateParam('search', val),
        placeholder: 'Search actor, action or entity ID…',
        label: 'Search audit log',
        debounceMs: 300,
      }}
      hasActiveFilters={Boolean(hasActiveFilters)}
      onClearAll={handleReset}
      filters={
        <>
          <FilterField label="Source" htmlFor="audit-filter-source">
            <Select value={currentVia} onValueChange={val => updateParam('via', val)}>
              <SelectTrigger id="audit-filter-source" className="h-9 w-[170px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                <SelectItem value="assistant">AI assistants</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Entity type" htmlFor="audit-filter-entity">
            <Select
              value={currentEntityType || 'ALL'}
              onValueChange={val => updateParam('entityType', val)}
            >
              <SelectTrigger id="audit-filter-entity" className="h-9 w-[190px] text-sm">
                <SelectValue placeholder="All entity types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All entity types</SelectItem>
                {AUDIT_ENTITY_TYPES.map(type => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={logsData.length === 0}
          className="h-9 gap-1.5"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export page as CSV
        </Button>
      }
    />
  );
}
