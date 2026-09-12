'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Mail,
  CheckCircle2,
  XCircle,
  Trash2,
  X,
  Download,
  Users,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { logger } from '@/lib/logger';
import { Badge } from '@/components/ui/shadcn/badge';
import Button from '@/components/ui/Button';

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

interface SubscribersMetrics {
  totalActive: number;
  totalUnsubscribed: number;
  totalVerified: number;
}

interface SubscribersData {
  subscribers: Subscriber[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  metrics?: SubscribersMetrics;
}

type FilterStatus = 'all' | 'verified' | 'unverified' | 'unsubscribed';

export default function StatusPageSubscribers({ statusPageId }: { statusPageId: string }) {
  const [data, setData] = useState<SubscribersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [singleCandidateId, setSingleCandidateId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchSubscribers = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          statusPageId,
        });

        if (filter === 'verified') {
          params.set('verified', 'true');
          params.set('status', 'active');
        } else if (filter === 'unverified') {
          params.set('verified', 'false');
          params.set('status', 'active');
        } else if (filter === 'unsubscribed') {
          params.set('status', 'unsubscribed');
        }

        if (debouncedSearch) {
          params.set('email', debouncedSearch);
        }

        const response = await fetch(`/api/status-page/subscribers?${params}`, { signal });
        const result = await response.json();

        if (response.ok) {
          setData(result);
        } else {
          logger.error('Failed to fetch subscribers', { error: result.error });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof Error) {
          logger.error('Error fetching subscribers', { error: error.message });
        } else {
          logger.error('Error fetching subscribers', { error: String(error) });
        }
      } finally {
        setLoading(false);
      }
    },
    [page, limit, statusPageId, filter, debouncedSearch]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchSubscribers(controller.signal);
    return () => controller.abort();
  }, [fetchSubscribers]);

  // Clear selections whenever page or filter changes
  useEffect(() => {
    setSelectedIds(new Set());
    setSingleCandidateId(null);
  }, [page, limit, filter, debouncedSearch]);

  const activeSubscribersOnPage = useMemo(() => {
    return (data?.subscribers || []).filter(s => !s.unsubscribedAt);
  }, [data?.subscribers]);

  const isAllPageSelected = useMemo(() => {
    if (activeSubscribersOnPage.length === 0) return false;
    return activeSubscribersOnPage.every(s => selectedIds.has(s.id));
  }, [activeSubscribersOnPage, selectedIds]);

  const isPartiallySelected = useMemo(() => {
    if (isAllPageSelected) return false;
    return activeSubscribersOnPage.some(s => selectedIds.has(s.id));
  }, [activeSubscribersOnPage, selectedIds, isAllPageSelected]);

  const handleSelectAllToggle = () => {
    const next = new Set(selectedIds);
    if (isAllPageSelected) {
      activeSubscribersOnPage.forEach(s => next.delete(s.id));
    } else {
      activeSubscribersOnPage.forEach(s => next.add(s.id));
    }
    setSelectedIds(next);
  };

  const handleToggleRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSingleUnsubscribe = async (id: string) => {
    if (singleCandidateId !== id) {
      setSingleCandidateId(id);
      return;
    }

    setActionError(null);
    setActionSuccess(null);

    try {
      const response = await fetch(
        `/api/status-page/subscribers?id=${encodeURIComponent(id)}&statusPageId=${encodeURIComponent(statusPageId)}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        setSingleCandidateId(null);
        setActionSuccess('Subscriber successfully unsubscribed.');
        void fetchSubscribers();
      } else {
        const result = (await response.json()) as { error?: string };
        setActionError(result.error || 'Failed to unsubscribe.');
      }
    } catch {
      setActionError('Failed to remove subscriber.');
    }
  };

  const handleBulkUnsubscribe = async () => {
    if (selectedIds.size === 0) return;

    setActionError(null);
    setActionSuccess(null);
    setIsBulkDeleting(true);

    try {
      const response = await fetch('/api/status-page/subscribers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          statusPageId,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setActionSuccess(result.message || `${selectedIds.size} subscribers unsubscribed.`);
        setSelectedIds(new Set());
        void fetchSubscribers();
      } else {
        const result = (await response.json()) as { error?: string };
        setActionError(result.error || 'Failed to bulk unsubscribe.');
      }
    } catch {
      setActionError('Failed to complete bulk unsubscribe.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleExportCsv = () => {
    if (!data?.subscribers || data.subscribers.length === 0) return;
    const headers = ['Email', 'Status', 'Subscribed At', 'Unsubscribed At'];
    const rows = data.subscribers.map(sub => [
      sub.email,
      sub.unsubscribedAt ? 'Unsubscribed' : sub.verified ? 'Verified' : 'Unverified',
      new Date(sub.subscribedAt).toISOString(),
      sub.unsubscribedAt ? new Date(sub.unsubscribedAt).toISOString() : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(v => `"${v}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `subscribers_${statusPageId}_page_${page}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 text-foreground">
      {/* Alert Banners */}
      {actionError && (
        <div className="flex items-center gap-2 p-3 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-center gap-2 p-3 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Filter & Toolbar Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Box with Instant Debounce & Clear Icon */}
        <div className="relative flex items-center flex-1 max-w-md">
          <input
            type="text"
            className="status-page-subscribers-search-input w-full text-sm bg-background border border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            placeholder="Search subscribers by email..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center bg-muted/60 p-1 rounded-lg border border-border/80 text-xs font-medium">
            <button
              type="button"
              className={`px-3 py-1 rounded-md transition-all ${
                filter === 'all'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setFilter('all');
                setPage(1);
              }}
            >
              All {data?.total !== undefined && `(${data.total})`}
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded-md transition-all ${
                filter === 'verified'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setFilter('verified');
                setPage(1);
              }}
            >
              Verified{' '}
              {data?.metrics?.totalVerified !== undefined && `(${data.metrics.totalVerified})`}
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded-md transition-all ${
                filter === 'unverified'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setFilter('unverified');
                setPage(1);
              }}
            >
              Unverified
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded-md transition-all ${
                filter === 'unsubscribed'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setFilter('unsubscribed');
                setPage(1);
              }}
            >
              Unsubscribed{' '}
              {data?.metrics?.totalUnsubscribed !== undefined &&
                `(${data.metrics.totalUnsubscribed})`}
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data?.subscribers || data.subscribers.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border/80 rounded-lg bg-card hover:bg-muted/40 text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
            title="Export this page to CSV"
          >
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Bulk Action Sticky Bar (Visible when items selected) */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-xl animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span>
              <strong>{selectedIds.size}</strong> subscriber{selectedIds.size !== 1 ? 's' : ''}{' '}
              selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Deselect all
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              isLoading={isBulkDeleting}
              onClick={handleBulkUnsubscribe}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Unsubscribe selected ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      {/* Subscribers Table Container */}
      <div className="border border-border/80 rounded-xl overflow-hidden bg-card">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs font-medium">Loading subscribers...</p>
          </div>
        ) : !data || data.subscribers.length === 0 ? (
          <div className="py-16 px-4 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <Mail className="w-6 h-6 text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No subscribers found</h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              {debouncedSearch
                ? `No subscribers match "${debouncedSearch}". Try a different search query.`
                : filter !== 'all'
                  ? `No subscribers match the current "${filter}" filter.`
                  : 'No one has subscribed to your status page yet.'}
            </p>
            {debouncedSearch && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="mt-3 text-xs font-medium text-primary hover:underline"
              >
                Clear search filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/80 bg-muted/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider select-none">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      ref={el => {
                        if (el) el.indeterminate = isPartiallySelected;
                      }}
                      onChange={handleSelectAllToggle}
                      disabled={activeSubscribersOnPage.length === 0}
                      className="rounded border-border text-primary focus:ring-primary h-4 w-4 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Select all on this page"
                    />
                  </th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Subscribed</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-xs">
                {data.subscribers.map(subscriber => {
                  const isUnsubscribed = Boolean(subscriber.unsubscribedAt);
                  const isChecked = selectedIds.has(subscriber.id);

                  return (
                    <tr
                      key={subscriber.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        isChecked ? 'bg-primary/5' : ''
                      }`}
                    >
                      {/* Selection Checkbox */}
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isUnsubscribed}
                          onChange={() => handleToggleRow(subscriber.id)}
                          className="rounded border-border text-primary focus:ring-primary h-4 w-4 transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                          aria-label={`Select ${subscriber.email}`}
                        />
                      </td>

                      {/* Email Address */}
                      <td className="py-3 px-4 font-medium text-foreground">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-muted/60 flex items-center justify-center shrink-0 text-muted-foreground">
                            <Mail className="w-3.5 h-3.5" />
                          </div>
                          <span className="truncate max-w-xs md:max-w-sm" title={subscriber.email}>
                            {subscriber.email}
                          </span>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-4">
                        {isUnsubscribed ? (
                          <Badge variant="neutral" size="xs" className="gap-1 font-medium">
                            <XCircle className="h-3 w-3 text-muted-foreground" />
                            Unsubscribed
                          </Badge>
                        ) : subscriber.verified ? (
                          <Badge variant="success" size="xs" className="gap-1 font-medium">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="danger" size="xs" className="gap-1 font-medium">
                            <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                            Unverified
                          </Badge>
                        )}
                      </td>

                      {/* Subscribed Date */}
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {new Date(subscriber.subscribedAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>

                      {/* Row Actions */}
                      <td className="py-3 px-4 text-right">
                        {!isUnsubscribed ? (
                          <button
                            type="button"
                            onClick={() => handleSingleUnsubscribe(subscriber.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-all ${
                              singleCandidateId === subscriber.id
                                ? 'border-destructive bg-destructive text-destructive-foreground shadow-xs animate-pulse'
                                : 'border-border/80 bg-background text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10'
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                            {singleCandidateId === subscriber.id ? 'Confirm?' : 'Unsubscribe'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60 italic">
                            Unsubscribed{' '}
                            {subscriber.unsubscribedAt &&
                              new Date(subscriber.unsubscribedAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer & Scalable Pagination Bar */}
        {data && data.total > 0 && (
          <div className="px-4 py-3 border-t border-border/80 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            {/* Range info & Page Size Selector */}
            <div className="flex items-center gap-3">
              <span>
                Showing{' '}
                <strong className="text-foreground">
                  {Math.min((data.page - 1) * data.limit + 1, data.total)}
                </strong>{' '}
                to{' '}
                <strong className="text-foreground">
                  {Math.min(data.page * data.limit, data.total)}
                </strong>{' '}
                of <strong className="text-foreground">{data.total}</strong> subscribers
              </span>

              <div className="flex items-center gap-1.5 border-l border-border/80 pl-3">
                <span>Per page:</span>
                <select
                  value={limit}
                  onChange={e => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-background border border-border/80 rounded px-1.5 py-0.5 text-xs text-foreground font-medium focus:outline-none"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* Pagination Controls */}
            {data.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <span className="mr-1">
                  Page <strong>{data.page}</strong> of <strong>{data.totalPages}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border/80 bg-card hover:bg-muted/50 text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                  disabled={data.page >= data.totalPages}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border/80 bg-card hover:bg-muted/50 text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
