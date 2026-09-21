'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  Clock3,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Radio,
  SlidersHorizontal,
  ExternalLink,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { logger } from '@/lib/logger';
import Link from 'next/link';
import {
  TwilioLogo,
  WhatsAppLogo,
  WebPushLogo,
  SmtpLogo,
} from '@/components/settings/ProviderBrandLogos';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import TablePaginationFooter from '@/components/ui/TablePaginationFooter';

type Props = {
  canRetry: boolean;
  /** Controlled from the parent (NotificationOperationsPage). */
  autoRefresh?: boolean;
  /** Pre-select a status filter — driven by Overview tab card clicks. */
  initialStatus?: string;
  /** Callback: parent receives latest stats so Overview cards reflect live data. */
  onStatsChange?: (stats: Record<string, number>) => void;
};

const CHANNELS = [
  'EMAIL',
  'SMS',
  'PUSH',
  'SLACK',
  'MICROSOFT_TEAMS',
  'WEBHOOK',
  'WHATSAPP',
] as const;
const STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'UNKNOWN'] as const;
const CATEGORIES = [
  'INCIDENT',
  'SECURITY',
  'STATUS_PAGE',
  'SLA',
  'ADMINISTRATION',
  'SYSTEM',
] as const;

const PAGE_SIZE = 20;

type Operation = {
  id: string;
  channel: string;
  status: string;
  category: string;
  recipientDisplay: string | null;
  templateKey: string | null;
  sourceType: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  sentAt: string | null;
  failedAt: string | null;
  errorMsg: string | null;
  createdAt: string;
  incident: { id: string; title: string } | null;
  lastAttempt: { outcome: string; latencyMs: number; startedAt: string } | null;
};

type OperationsResponse = {
  notifications: Operation[];
  stats: {
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
  };
  pagination: { nextCursor: string | null; hasMore: boolean };
};

function getChannelIcon(channel: string) {
  switch (channel.toUpperCase()) {
    case 'EMAIL':
      return <SmtpLogo size={14} />;
    case 'SMS':
      return <TwilioLogo size={14} />;
    case 'PUSH':
      return <WebPushLogo size={14} />;
    case 'WHATSAPP':
      return <WhatsAppLogo size={14} />;
    case 'SLACK':
      return <SlackLogo className="h-3.5 w-3.5 shrink-0" />;
    case 'MICROSOFT_TEAMS':
    case 'TEAMS':
      return <MicrosoftTeamsLogo className="h-3.5 w-3.5 shrink-0" />;
    case 'WEBHOOK':
    default:
      return <Radio className="h-3.5 w-3.5 text-amber-500" />;
  }
}

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function NotificationOperations({
  canRetry,
  autoRefresh = false,
  initialStatus = 'all',
  onStatsChange,
}: Props) {
  const [rows, setRows] = useState<Operation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState(initialStatus);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [page, setPage] = useState(1);
  const requestSequence = useRef(0);

  // Sync status from parent (Overview card click)
  useEffect(() => {
    setStatus(initialStatus);
    setPage(1);
  }, [initialStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchOperations = useCallback(
    async (nextCursor?: string) => {
      const sequence = ++requestSequence.current;
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      setError('');
      const params = new URLSearchParams({ limit: '200' }); // fetch a large batch, page client-side
      if (channel !== 'all') params.set('channel', channel);
      if (status !== 'all') params.set('status', status);
      if (category !== 'all') params.set('category', category);
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
      if (nextCursor) params.set('cursor', nextCursor);

      try {
        const response = await fetch(`/api/admin/notifications/operations?${params}`, {
          cache: 'no-store',
        });
        const body = (await response.json()) as OperationsResponse & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Unable to load delivery operations');
        if (sequence !== requestSequence.current) return;
        setRows(current => (nextCursor ? [...current, ...body.notifications] : body.notifications));
        onStatsChange?.(body.stats.byStatus || {});
        setCursor(body.pagination.nextCursor);
        setHasMore(body.pagination.hasMore);
      } catch (caught) {
        if (sequence !== requestSequence.current) return;
        const message =
          caught instanceof Error ? caught.message : 'Unable to load delivery operations';
        setError(message);
        logger.error('settings.notification_operations.load_failed', { error: message });
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [category, channel, debouncedQuery, from, onStatsChange, status, to]
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [channel, status, category, debouncedQuery, from, to]);

  useEffect(() => {
    void fetchOperations();
  }, [fetchOperations]);

  // External auto-refresh polling — driven by parent's toggle
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      void fetchOperations();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, fetchOperations]);

  const retry = async (id: string) => {
    setRetryingId(id);
    setError('');
    try {
      const response = await fetch(`/api/admin/notifications/operations/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to requeue notification');
      await fetchOperations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to requeue notification');
    } finally {
      setRetryingId(null);
    }
  };

  const applyDatePreset = (preset: 'today' | '7d' | '30d') => {
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    let fromStr = toStr;
    if (preset === '7d') {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      fromStr = d.toISOString().slice(0, 10);
    } else if (preset === '30d') {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      fromStr = d.toISOString().slice(0, 10);
    }
    if (from === fromStr && to === toStr) {
      setFrom('');
      setTo('');
    } else {
      setFrom(fromStr);
      setTo(toStr);
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    let av: string | number = '';
    let bv: string | number = '';
    if (sortBy === 'createdAt') {
      av = a.createdAt || '';
      bv = b.createdAt || '';
    } else if (sortBy === 'channel') {
      av = a.channel;
      bv = b.channel;
    } else if (sortBy === 'status') {
      av = a.status;
      bv = b.status;
    } else if (sortBy === 'attempts') {
      av = a.attempts;
      bv = b.attempts;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Paginate the sorted rows
  const totalCount = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pagedRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const bulkRetry = async () => {
    const failedRows = rows.filter(r => r.status === 'FAILED');
    if (failedRows.length === 0) return;
    setBulkRetrying(true);
    setError('');
    try {
      await Promise.all(
        failedRows.map(r =>
          fetch(`/api/admin/notifications/operations/${r.id}/retry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        )
      );
      await fetchOperations();
    } catch {
      setError('One or more retries failed. Check individual rows.');
    } finally {
      setBulkRetrying(false);
    }
  };

  const exportCsv = () => {
    const headers = [
      'ID',
      'Channel',
      'Status',
      'Category',
      'Template',
      'Destination',
      'Source',
      'Attempts',
      'Latency(ms)',
      'Timestamp',
      'Error',
    ];
    const csvRows = [
      headers,
      ...rows.map(r => [
        r.id,
        r.channel,
        r.status,
        r.category,
        r.templateKey || '',
        r.recipientDisplay || '',
        r.incident?.title || r.sourceType || '',
        r.attempts,
        r.lastAttempt?.latencyMs ?? '',
        r.createdAt,
        r.errorMsg || '',
      ]),
    ];
    const csv = csvRows
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notification-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
    setPage(1);
  };

  // Load next batch from API if we've paged to the end of the current batch
  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    if (nextPage === totalPages && hasMore && cursor) {
      void fetchOperations(cursor);
    }
  };

  return (
    <div className="space-y-0">
      {/* Filters & Operations Table Card */}
      <Card className="border-border/80 shadow-xs bg-card overflow-hidden">
        <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/60">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Delivery Telemetry &amp; Queue Log
              </CardTitle>
              <CardDescription className="text-xs">
                Real-time queue tracking across all outbound notification integrations.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 self-end lg:self-auto flex-wrap">
              {canRetry && status === 'FAILED' && rows.some(r => r.status === 'FAILED') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void bulkRetry()}
                  disabled={bulkRetrying}
                  className="text-xs font-semibold h-8 gap-1.5 border-rose-500/30 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400"
                >
                  {bulkRetrying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Retry All Failed
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={rows.length === 0}
                className="text-xs font-semibold h-8 gap-1.5 border-border/80 hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchOperations()}
                disabled={loading}
                className="text-xs font-semibold h-8 gap-1.5 border-border/80 hover:bg-accent"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-3">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                aria-label="Search delivery operations"
                className="pl-8 text-xs h-8 bg-background border-border/80"
                placeholder="Search source, incident, or recipient..."
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </div>

            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger
                aria-label="Filter by channel"
                className="text-xs h-8 bg-background border-border/80"
              >
                <SelectValue placeholder="All Channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Channels
                </SelectItem>
                {CHANNELS.map(value => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status}
              onValueChange={v => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Filter by status"
                className="text-xs h-8 bg-background border-border/80"
              >
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Statuses
                </SelectItem>
                {STATUSES.map(value => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                aria-label="Filter by category"
                className="text-xs h-8 bg-background border-border/80"
              >
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All Categories
                </SelectItem>
                {CATEGORIES.map(value => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-1">
                {[
                  { id: 'today', label: 'Today', days: 0 },
                  { id: '7d', label: 'Last 7d', days: 6 },
                  { id: '30d', label: 'Last 30d', days: 29 },
                ].map(preset => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  let expectedFrom = todayStr;
                  if (preset.days > 0) {
                    const d = new Date();
                    d.setDate(d.getDate() - preset.days);
                    expectedFrom = d.toISOString().slice(0, 10);
                  }
                  const isActive = from === expectedFrom && to === todayStr;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyDatePreset(preset.id as 'today' | '7d' | '30d')}
                      className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                        isActive
                          ? 'bg-primary/10 border-primary/40 text-primary'
                          : 'bg-background border-border/80 text-muted-foreground hover:text-foreground hover:border-border'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label="From date"
                  type="date"
                  className="text-xs h-8 bg-background border-border/80 w-1/2"
                  value={from}
                  onChange={event => setFrom(event.target.value)}
                />
                <Input
                  aria-label="To date"
                  type="date"
                  className="text-xs h-8 bg-background border-border/80 w-1/2"
                  value={to}
                  onChange={event => setTo(event.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {error && (
            <div className="p-4 border-b border-border/60">
              <Alert variant="destructive" className="py-2.5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-xs font-bold">Telemetry Unavailable</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/60 hover:bg-transparent bg-muted/30">
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('status')}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      Status <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('channel')}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      Channel &amp; Category <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Masked Destination
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Trigger Source
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('attempts')}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      Attempts &amp; Latency <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('createdAt')}
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      Timestamp <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  {canRetry && (
                    <TableHead className="text-xs font-bold text-foreground py-3 text-right">
                      Action
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={canRetry ? 7 : 6} className="h-36 text-center">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground">
                          Loading delivery telemetry...
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canRetry ? 7 : 6} className="h-36 text-center">
                      <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                        <Activity className="h-5 w-5 opacity-40" />
                        <p className="text-xs font-semibold text-foreground">
                          No operations match these filters
                        </p>
                        <p className="text-[11px]">
                          Try adjusting your search query, status, or date range.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map(row => {
                    const isDelivered = row.status === 'DELIVERED';
                    const isAccepted = row.status === 'SENT';
                    const isPending = row.status === 'PENDING';
                    const isFailed = row.status === 'FAILED';

                    return (
                      <TableRow
                        key={row.id}
                        className="border-b border-border/40 hover:bg-muted/30"
                      >
                        <TableCell className="py-3">
                          {isDelivered ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {row.status}
                            </Badge>
                          ) : isAccepted ? (
                            <Badge
                              variant="outline"
                              className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold"
                            >
                              Accepted
                            </Badge>
                          ) : isPending ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 inline-flex items-center gap-1"
                            >
                              <Clock3 className="h-3 w-3 animate-pulse" />
                              {row.status}
                            </Badge>
                          ) : isFailed ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 inline-flex items-center gap-1"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {row.status}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border-border/80"
                            >
                              {row.status}
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            {getChannelIcon(row.channel)}
                            <span className="text-xs font-bold text-foreground">{row.channel}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <span>{row.category}</span>
                            <span>·</span>
                            <code className="text-[10px] font-mono bg-muted/60 px-1 py-0.2 rounded border border-border/40">
                              {row.templateKey || 'direct_dispatch'}
                            </code>
                          </div>
                          {row.errorMsg && (
                            <div
                              className="mt-1 max-w-xs truncate text-[11px] text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 flex items-center gap-1"
                              title={row.errorMsg}
                            >
                              <AlertTriangle className="h-3 w-3 shrink-0 text-rose-500" />
                              <span className="truncate">{row.errorMsg}</span>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="font-mono text-xs py-2.5 whitespace-nowrap">
                          <span className="bg-muted/50 text-foreground px-2 py-0.5 rounded-md border border-border/50 text-[11px] inline-block">
                            {row.recipientDisplay || 'Encrypted Recipient'}
                          </span>
                        </TableCell>

                        <TableCell className="py-2.5">
                          {row.incident ? (
                            <Link
                              href={`/incidents/${row.incident.id}`}
                              className="text-xs font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1 max-w-xs truncate"
                            >
                              <span className="truncate">{row.incident.title}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </Link>
                          ) : (
                            <div className="max-w-xs truncate text-xs font-semibold text-foreground">
                              {row.sourceType || 'System Event'}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {row.sourceType || 'Internal Trigger'}
                          </div>
                        </TableCell>

                        <TableCell className="py-2.5">
                          <div className="text-xs font-mono tabular-nums font-semibold text-foreground">
                            {row.attempts} / {row.maxAttempts}
                          </div>
                          {row.lastAttempt && (
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {row.lastAttempt.latencyMs}ms latency
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-xs py-2.5 text-muted-foreground">
                          <div>{formatTimestamp(row.createdAt)}</div>
                          {row.status === 'PENDING' && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400">
                              Next: {formatTimestamp(row.nextAttemptAt)}
                            </div>
                          )}
                        </TableCell>

                        {canRetry && (
                          <TableCell className="text-right py-2.5">
                            {row.status === 'FAILED' && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={retryingId === row.id}
                                onClick={() => void retry(row.id)}
                                className="h-7 text-xs font-semibold gap-1 border-rose-500/30 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400"
                              >
                                {retryingId === row.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                Requeue
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          {!loading && totalCount > 0 && (
            <TablePaginationFooter
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={totalCount}
              onPageChange={handlePageChange}
            />
          )}

          {/* Load more from API if there are additional cursor pages */}
          {hasMore && cursor && !loading && page === totalPages && (
            <div className="flex justify-center border-t border-border/60 py-3">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void fetchOperations(cursor)}
                className="text-xs font-semibold gap-1.5 border-border/80"
              >
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Load More from Server
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
