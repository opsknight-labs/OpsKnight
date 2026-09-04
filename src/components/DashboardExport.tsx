'use client';

import { useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Button } from '@/components/ui/shadcn/button';
import { Download } from 'lucide-react';
import type { MetricDataState } from '@/lib/metric-contract';

type ExportProps = {
  incidents: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  filters: {
    status?: string;
    service?: string;
    assignee?: string;
    urgency?: string;
    search?: string;
    range?: string;
    startDate?: string;
    endDate?: string;
  };
  metrics: {
    totalActive: number;
    totalTriggered: number;
    totalMuted: number;
    totalSnoozed: number;
    totalSuppressed: number;
    totalResolved: number;
    totalAcknowledged: number;
    unassigned: number;
    dataState: MetricDataState;
  };
};

function escapeCSVField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  const trimmed = str.trimStart();
  if (/^[=+\-@\t\r|%]/.test(trimmed)) {
    str = `'${str}`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function DashboardExport({ incidents, filters, metrics }: ExportProps) {
  const { userTimeZone } = useTimezone();
  const [isExporting, setIsExporting] = useState(false);

  const exportToCSV = () => {
    setIsExporting(true);

    const csvRows: string[] = [];

    // Header
    csvRows.push(escapeCSVField('OpsKnight Dashboard Export'));
    csvRows.push(
      escapeCSVField(
        `Generated: ${formatDateTime(new Date(), userTimeZone, { format: 'datetime' })}`
      )
    );
    csvRows.push('');

    // Filters
    csvRows.push('Active Filters:');
    if (filters.status) csvRows.push(`Status: ${escapeCSVField(filters.status)}`);
    if (filters.service) csvRows.push(`Service: ${escapeCSVField(filters.service)}`);
    if (filters.assignee !== undefined) {
      csvRows.push(
        `Assignee: ${escapeCSVField(filters.assignee === '' ? 'Unassigned' : filters.assignee)}`
      );
    }
    if (filters.urgency) csvRows.push(`Urgency: ${escapeCSVField(filters.urgency)}`);
    if (filters.search) csvRows.push(`Search: ${escapeCSVField(filters.search)}`);
    if (filters.range) {
      if (filters.range === 'all') {
        csvRows.push('Time Range: All time');
      } else if (filters.range === 'custom') {
        const start = filters.startDate
          ? formatDateTime(filters.startDate, userTimeZone, { format: 'date' })
          : 'N/A';
        const end = filters.endDate
          ? formatDateTime(filters.endDate, userTimeZone, { format: 'date' })
          : 'N/A';
        csvRows.push(`Time Range: Custom (${escapeCSVField(start)} - ${escapeCSVField(end)})`);
      } else {
        csvRows.push(`Time Range: ${escapeCSVField(filters.range)} days`);
      }
    }
    csvRows.push('');

    // Metrics Summary
    csvRows.push('Metrics Summary:');
    csvRows.push(`Metric Data State,${metrics.dataState}`);
    if (metrics.dataState === 'unavailable') {
      csvRows.push('Metric values,N/A');
      csvRows.push('');
    } else {
      csvRows.push(`Active Incidents (current),${metrics.totalActive}`);
      csvRows.push(`Triggered Incidents (current),${metrics.totalTriggered}`);
      csvRows.push(`Acknowledged Incidents (current),${metrics.totalAcknowledged}`);
      csvRows.push(`Muted Incidents (current),${metrics.totalMuted}`);
      csvRows.push(`Snoozed Incidents (current),${metrics.totalSnoozed}`);
      csvRows.push(`Suppressed Incidents (current),${metrics.totalSuppressed}`);
      csvRows.push(`Unassigned Active Incidents (current),${metrics.unassigned}`);
      csvRows.push(`Resolved Incidents (selected period),${metrics.totalResolved}`);
      csvRows.push('');
    }

    // Incidents Data
    csvRows.push('Incidents:');
    csvRows.push('ID,Title,Status,Urgency,Service,Assignee,Created At');
    incidents.forEach(incident => {
      const row = [
        escapeCSVField(incident.id),
        escapeCSVField(incident.title),
        escapeCSVField(incident.status),
        escapeCSVField(incident.urgency || 'N/A'),
        escapeCSVField(incident.service?.name || 'N/A'),
        escapeCSVField(incident.assignee?.name || incident.team?.name || 'Unassigned'),
        escapeCSVField(formatDateTime(incident.createdAt, userTimeZone, { format: 'datetime' })),
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `dashboard-export-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => setIsExporting(false), 500);
  };

  return (
    <Button
      onClick={exportToCSV}
      disabled={isExporting}
      variant="outline"
      size="sm"
      className="h-8 gap-2 bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-slate-700/80 font-semibold shadow-xs transition-all disabled:opacity-60"
      title="Export dashboard data to CSV"
    >
      <Download className="h-3.5 w-3.5" />
      {isExporting ? 'Exporting...' : 'Export CSV'}
    </Button>
  );
}
