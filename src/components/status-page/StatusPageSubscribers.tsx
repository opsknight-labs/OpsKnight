'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Mail, CheckCircle2, XCircle, Trash2, Search } from 'lucide-react';
import { logger } from '@/lib/logger';
import { Badge } from '@/components/ui/shadcn/badge';

interface Subscriber {
    id: string;
    email: string;
    verified: boolean;
    subscribedAt: string;
    unsubscribedAt: string | null;
    statusPage: {
        id: string;
        name: string;
    };
}

interface SubscribersData {
    subscribers: Subscriber[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export default function StatusPageSubscribers({ statusPageId }: { statusPageId: string }) {
    const [data, setData] = useState<SubscribersData | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<'all' | 'verified' | 'unverified'>('all');
    const [searchEmail, setSearchEmail] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const limit = 10;

    const fetchSubscribers = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                statusPageId,
            });

            if (filter === 'verified') params.set('verified', 'true');
            if (filter === 'unverified') params.set('verified', 'false');
            if (searchEmail) params.set('email', searchEmail);

            const response = await fetch(`/api/status-page/subscribers?${params}`);
            const result = await response.json();

            if (response.ok) {
                setData(result);
            } else {
                logger.error('Failed to fetch subscribers', { error: result.error });
            }
        } catch (error) {
            if (error instanceof Error) {
                logger.error('Error fetching subscribers', { error: error.message });
            } else {
                logger.error('Error fetching subscribers', { error: String(error) });
            }
        } finally {
            setLoading(false);
        }
    }, [page, limit, statusPageId, filter, searchEmail]);

    useEffect(() => {
        fetchSubscribers();
    }, [fetchSubscribers]);

    const handleUnsubscribe = async (subscriptionId: string) => {
        // eslint-disable-next-line no-alert
        if (!confirm('Are you sure you want to remove this subscriber?')) { return; }

        try {
            const response = await fetch(`/api/status-page/subscribers?id=${subscriptionId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                fetchSubscribers();
            } else {
                const result = await response.json();
                // eslint-disable-next-line no-alert
                alert(`Failed to unsubscribe: ${result.error}`);
            }
        } catch (error) {
            if (error instanceof Error) {
                logger.error('Error unsubscribing', { error: error.message });
            } else {
                logger.error('Error unsubscribing', { error: String(error) });
            }
            // eslint-disable-next-line no-alert
            alert('Subscriber removed successfully');
        }
    };

    const handleSearch = () => {
        setSearchEmail(searchInput);
        setPage(1);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <div className="status-page-subscribers">
            <style jsx>{`
                .status-page-subscribers {
                    background: white;
                    border-radius: 8px;
                    padding: 24px;
                    border: 1px solid #e5e7eb;
                }

                .subscribers-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                }

                .subscribers-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: #1f2937;
                }

                .subscribers-filters {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                }

                .search-box {
                    display: flex;
                    gap: 8px;
                    flex: 1;
                    min-width: 250px;
                }

                .search-input {
                    flex: 1;
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                }

                .search-btn {
                    padding: 8px 16px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .search-btn:hover {
                    background: #5568d3;
                }

                .filter-group {
                    display: flex;
                    gap: 8px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    padding: 4px;
                    background: #f9fafb;
                }

                .filter-btn {
                    padding: 6px 12px;
                    border: none;
                    background: transparent;
                    color: #6b7280;
                    font-size: 14px;
                    font-weight: 500;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .filter-btn.active {
                    background: white;
                    color: #667eea;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                }

                .subscribers-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .subscribers-table th {
                    text-align: left;
                    padding: 12px;
                    background: #f9fafb;
                    border-bottom: 1px solid #e5e7eb;
                    font-size: 13px;
                    font-weight: 600;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .subscribers-table td {
                    padding: 16px 12px;
                    border-bottom: 1px solid #e5e7eb;
                    font-size: 14px;
                    color: #374151;
                }

                .email-cell {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .status-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .status-verified {
                    background: #d1fae5;
                    color: #065f46;
                }

                .status-unverified {
                    background: #fee2e2;
                    color: #991b1b;
                }

                .status-unsubscribed {
                    background: #f3f4f6;
                    color: #6b7280;
                }

                .action-btn {
                    padding: 6px 12px;
                    border: 1px solid #d1d5db;
                    background: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 13px;
                    color: #dc2626;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s;
                }

                .action-btn:hover {
                    background: #fee2e2;
                    border-color: #dc2626;
                }

                .pagination {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: 20px;
                    padding-top: 20px;
                    border-top: 1px solid #e5e7eb;
                }

                .pagination-info {
                    font-size: 14px;
                    color: #6b7280;
                }

                .pagination-controls {
                    display: flex;
                    gap: 8px;
                }

                .pagination-btn {
                    padding: 8px 12px;
                    border: 1px solid #d1d5db;
                    background: white;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #374151;
                }

                .pagination-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .pagination-btn:hover:not(:disabled) {
                    background: #f9fafb;
                }

                .loading, .no-data {
                    text-align: center;
                    padding: 40px;
                    color: #6b7280;
                }
            `}</style>

            <div className="subscribers-header">
                <h2 className="subscribers-title">Email Subscribers</h2>
                {data && (
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                        {data.total} total subscriber{data.total !== 1 && 's'}
                    </div>
                )}
            </div>

            <div className="subscribers-filters">
                <div className="search-box">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search by email..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                    />
                    <button className="search-btn" onClick={handleSearch}>
                        <Search size={16} />
                        Search
                    </button>
                </div>

                <div className="filter-group">
                    <button
                        className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                        onClick={() => { setFilter('all'); setPage(1); }}
                    >
                        All
                    </button>
                    <button
                        className={`filter-btn ${filter === 'verified' ? 'active' : ''}`}
                        onClick={() => { setFilter('verified'); setPage(1); }}
                    >
                        Verified
                    </button>
                    <button
                        className={`filter-btn ${filter === 'unverified' ? 'active' : ''}`}
                        onClick={() => { setFilter('unverified'); setPage(1); }}
                    >
                        Unverified
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="loading">Loading subscribers...</div>
            ) : !data || data.subscribers.length === 0 ? (
                <div className="no-data">
                    <Mail size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
                    <p>No subscribers found.</p>
                </div>
            ) : (
                <>
                    <table className="subscribers-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Status</th>
                                <th>Subscribed</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.subscribers.map((subscriber) => (
                                <tr key={subscriber.id}>
                                    <td>
                                        <div className="email-cell">
                                            <Mail size={16} style={{ color: '#9ca3af' }} />
                                            {subscriber.email}
                                        </div>
                                    </td>
                                    <td>
                                        {subscriber.unsubscribedAt ? (
                                            <Badge variant="neutral" size="xs" className="gap-1">
                                                <XCircle className="h-3 w-3" />
                                                Unsubscribed
                                            </Badge>
                                        ) : subscriber.verified ? (
                                            <Badge variant="success" size="xs" className="gap-1">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Verified
                                            </Badge>
                                        ) : (
                                            <Badge variant="danger" size="xs" className="gap-1">
                                                <XCircle className="h-3 w-3" />
                                                Unverified
                                            </Badge>
                                        )}
                                    </td>
                                    <td>
                                        {new Date(subscriber.subscribedAt).toLocaleDateString('en-US', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                    </td>
                                    <td>
                                        {!subscriber.unsubscribedAt && (
                                            <button
                                                className="action-btn"
                                                onClick={() => handleUnsubscribe(subscriber.id)}
                                            >
                                                <Trash2 size={14} />
                                                Unsubscribe
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {data.totalPages > 1 && (
                        <div className="pagination">
                            <div className="pagination-info">
                                Page {data.page} of {data.totalPages}
                            </div>
                            <div className="pagination-controls">
                                <button
                                    className="pagination-btn"
                                    onClick={() => setPage(page - 1)}
                                    disabled={page === 1}
                                >
                                    <ChevronLeft size={16} />
                                    Previous
                                </button>
                                <button
                                    className="pagination-btn"
                                    onClick={() => setPage(page + 1)}
                                    disabled={page === data.totalPages}
                                >
                                    Next
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
