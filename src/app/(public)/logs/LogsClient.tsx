'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type LogEntry = {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
    context?: Record<string, unknown>;
    component?: string;
    requestId?: string;
    userId?: string;
    duration?: number;
    error?: {
        message: string;
        name?: string;
    };
};

const REFRESH_MS = 5000;
const DEFAULT_LIMIT = 200;

function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleTimeString();
}

export default function LogsClient() {
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [levelFilter, setLevelFilter] = useState<'all' | LogEntry['level']>('all');

    const fetchLogs = useCallback(async () => {
        try {
            setError(null);
            const response = await fetch(`/api/public-logs?limit=${DEFAULT_LIMIT}`, {
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`Failed to load logs (${response.status})`);
            }
            const data = await response.json();
            setEntries(Array.isArray(data?.data) ? data.data : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load logs');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, REFRESH_MS);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    const filteredEntries = useMemo(() => {
        if (levelFilter === 'all') return entries;
        return entries.filter((entry) => entry.level === levelFilter);
    }, [entries, levelFilter]);

    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label htmlFor="log-level-filter" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        Level
                    </label>
                    <select
                        id="log-level-filter"
                        value={levelFilter}
                        onChange={(event) => setLevelFilter(event.target.value as any)} // eslint-disable-line @typescript-eslint/no-explicit-any
                        style={{
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '0.45rem 0.75rem',
                            fontSize: '0.9rem'
                        }}
                    >
                        <option value="all">All</option>
                        <option value="error">Error</option>
                        <option value="warn">Warn</option>
                        <option value="info">Info</option>
                        <option value="debug">Debug</option>
                    </select>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {filteredEntries.length} entries
                    </span>
                </div>
                <button
                    type="button"
                    className="glass-button"
                    onClick={fetchLogs}
                >
                    Refresh
                </button>
            </div>

            {error && (
                <div className="settings-alert error" style={{ padding: '0.75rem 1rem' }}>
                    {error}
                </div>
            )}

            {loading && !entries.length ? (
                <div style={{ color: 'var(--text-muted)' }}>Loading logs...</div>
            ) : (
                <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    overflow: 'hidden'
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '0.75rem' }}>Time</th>
                                <th style={{ textAlign: 'left', padding: '0.75rem' }}>Level</th>
                                <th style={{ textAlign: 'left', padding: '0.75rem' }}>Message</th>
                                <th style={{ textAlign: 'left', padding: '0.75rem' }}>Context</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEntries.map((entry, index) => (
                                <tr key={`${entry.timestamp}-${index}`} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '0.75rem', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                        {formatTime(entry.timestamp)}
                                    </td>
                                    <td style={{ padding: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>
                                        {entry.level}
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <div style={{ fontWeight: 600 }}>{entry.message}</div>
                                        {entry.error?.message && (
                                            <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>
                                                {entry.error.name ? `${entry.error.name}: ` : ''}{entry.error.message}
                                            </div>
                                        )}
                                    </td>
                                    <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        {entry.component && <div>component: {entry.component}</div>}
                                        {entry.requestId && <div>requestId: {entry.requestId}</div>}
                                        {entry.userId && <div>userId: {entry.userId}</div>}
                                        {entry.duration !== undefined && <div>duration: {entry.duration}ms</div>}
                                        {entry.context && Object.keys(entry.context).length > 0 && (
                                            <pre style={{
                                                margin: '0.35rem 0 0',
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-word',
                                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                                            }}>
                                                {JSON.stringify(entry.context, null, 2)}
                                            </pre>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {filteredEntries.length === 0 && (
                                <tr>
                                    <td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        No log entries available yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
