'use client';

import { useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

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
    totalOpen: number;
    totalResolved: number;
    totalAcknowledged: number;
    unassigned: number;
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
    csvRows.push(escapeCSVField(`Generated: ${formatDateTime(new Date(), userTimeZone, { format: 'datetime' })}`));
    csvRows.push('');

    // Filters
    csvRows.push('Active Filters:');
    if (filters.status) csvRows.push(`Status: ${escapeCSVField(filters.status)}`);
    if (filters.service) csvRows.push(`Service: ${escapeCSVField(filters.service)}`);
    if (filters.assignee !== undefined) {
      csvRows.push(`Assignee: ${escapeCSVField(filters.assignee === '' ? 'Unassigned' : filters.assignee)}`);
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
    csvRows.push(`Open Incidents,${metrics.totalOpen}`);
    csvRows.push(`Resolved Incidents,${metrics.totalResolved}`);
    csvRows.push(`Acknowledged Incidents,${metrics.totalAcknowledged}`);
    csvRows.push(`Unassigned Incidents,${metrics.unassigned}`);
    csvRows.push('');

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
    <button
      onClick={exportToCSV}
      disabled={isExporting}
      style={{
        padding: '0.5rem 1rem',
        borderRadius: '8px',
        fontSize: '0.85rem',
        border: 'none',
        background: 'white',
        cursor: isExporting ? 'not-allowed' : 'pointer',
        color: '#1f2937',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        opacity: isExporting ? 0.6 : 1,
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      }}
      title="Export dashboard data to CSV"
      onMouseEnter={e => {
        if (!isExporting) {
          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {isExporting ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}
