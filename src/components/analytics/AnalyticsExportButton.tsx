'use client';

import { logger } from '@/lib/logger';
import { useState } from 'react';

interface AnalyticsExportButtonProps {
    filters: {
        team?: string;
        service?: string;
        assignee?: string;
        status?: string;
        urgency?: string;
        window?: string;
    };
}

export default function AnalyticsExportButton({ filters }: AnalyticsExportButtonProps) {
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
            params.append('format', 'csv');

            const response = await fetch(`/api/analytics/export?${params.toString()}`);

            if (!response.ok) {
                throw new Error('Export failed');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `analytics-report-${timestamp}.csv`;
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

    return (
        <button
            onClick={handleExport}
            disabled={isExporting}
            type="button"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.4rem',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#d32f2f',
                color: 'white',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: isExporting ? 'wait' : 'pointer',
                boxShadow: '0 1px 2px rgba(17, 24, 39, 0.06)',
                transition: 'all 0.2s ease',
                opacity: isExporting ? 0.7 : 1,
                whiteSpace: 'nowrap',
                visibility: 'visible',
                position: 'relative',
                zIndex: 1000,
                minWidth: '120px'
            }}
            onMouseEnter={(e) => {
                if (!isExporting) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 10px 24px rgba(17, 24, 39, 0.12)';
                    e.currentTarget.style.backgroundColor = '#b71c1c';
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 2px rgba(17, 24, 39, 0.06)';
                e.currentTarget.style.backgroundColor = '#d32f2f';
            }}
        >
            {isExporting ? (
                <>
                    <span>⏳</span>
                    Exporting...
                </>
            ) : (
                <>
                    <span>📥</span>
                    Export CSV
                </>
            )}
        </button>
    );
}

