'use client';

import { logger } from '@/lib/logger';
import { useState } from 'react';

interface ExportButtonProps {
  filters: {
    team?: string;
    service?: string;
    assignee?: string;
    status?: string;
    urgency?: string;
    window?: string;
  };
  format?: 'csv' | 'pdf' | 'excel';
}

export default function ExportButton({ filters, format = 'csv' }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'ALL') {
          params.append(key, value);
        }
      });
      params.append('format', format);

      const response = await fetch(`/api/analytics/export?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `analytics-report-${timestamp}.${format === 'excel' ? 'xlsx' : format}`;
      a.download = filename;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Export error', { error: error.message });
      } else {
        logger.error('Export error', { error: String(error) });
      }
      alert('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const formatLabels = {
    csv: 'CSV',
    pdf: 'PDF',
    excel: 'Excel',
  };

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className="glass-button primary analytics-export-button"
      title={`Export analytics data as ${formatLabels[format]}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.4rem',
        borderRadius: '999px',
        border: 'none',
        backgroundColor: 'var(--primary-color)',
        color: 'white',
        fontWeight: 600,
        fontSize: '0.9rem',
        cursor: isExporting ? 'wait' : 'pointer',
        boxShadow: 'var(--shadow-sm)',
        transition: 'all 0.2s ease',
        opacity: isExporting ? 0.7 : 1,
      }}
      onMouseEnter={e => {
        if (!isExporting) {
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {isExporting ? (
        <>
          <span style={{ animation: 'spin 1s linear infinite' }}>⏳</span>
          Exporting...
        </>
      ) : (
        <>
          <span style={{ fontSize: '1rem' }}>📥</span>
          Export {formatLabels[format]}
        </>
      )}
    </button>
  );
}
