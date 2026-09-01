'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Mail,
  Phone,
  Bell,
  MessageSquare,
  Radio,
  MessageCircle,
  XCircle,
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
import { Switch } from '@/components/ui/shadcn/switch';
import { logger } from '@/lib/logger';
import Link from 'next/link';

const CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP'] as const;
const STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'] as const;
const CATEGORIES = [
  'INCIDENT',
  'SECURITY',
  'STATUS_PAGE',
  'SLA',
  'ADMINISTRATION',
  'SYSTEM',
] as const;

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

type Props = { canRetry: boolean };

function getChannelIcon(channel: string) {
  switch (channel) {
    case 'EMAIL':
      return <Mail className="h-3 w-3 text-blue-500" />;
    case 'SMS':
      return <Phone className="h-3 w-3 text-indigo-500" />;
    case 'PUSH':
      return <Bell className="h-3 w-3 text-purple-500" />;
    case 'SLACK':
      return <MessageSquare className="h-3 w-3 text-emerald-500" />;
    case 'WHATSAPP':
      return <MessageCircle className="h-3 w-3 text-green-500" />;
    case 'WEBHOOK':
    default:
      return <Radio className="h-3 w-3 text-amber-500" />;
  }
}

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function NotificationOperations({ canRetry }: Props) {
  const [rows, setRows] = useState<Operation[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const requestSequence = useRef(0);

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
      const params = new URLSearchParams({ limit: '50' });
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
        setStats(body.stats.byStatus || {});
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
    [category, channel, debouncedQuery, from, status, to]
  );

  useEffect(() => {
    void fetchOperations();
  }, [fetchOperations]);

  // Optional auto-refresh polling
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

  const total = Object.values(stats).reduce((sum, value) => sum + value, 0);
  const delivered = (stats.SENT || 0) + (stats.DELIVERED || 0);
  const pending = stats.PENDING || 0;
  const failed = stats.FAILED || 0;
  const skipped = stats.SKIPPED || 0;

  const handleStatusFilterClick = (targetStatus: string) => {
    if (status === targetStatus) {
      setStatus('all');
    } else {
      setStatus(targetStatus);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Privacy & Security Assurance Banner */}
      <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border/80 px-4 py-3 text-xs">
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>
            <strong className="text-foreground font-semibold">
              {canRetry ? 'Administrator Control Plane:' : 'Auditor Telemetry View:'}
            </strong>{' '}
            Delivery metadata is tracked with recipient masking and redacted error payloads. Secrets
            are never exposed.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            Auto-refresh (15s)
          </span>
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
        </div>
      </div>

      {/* 2. Interactive Queue Status Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setStatus('all')}
          className={`text-left p-4 rounded-xl border transition-all ${
            status === 'all'
              ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/40 shadow-xs'
              : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Total Dispatched</span>
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-black text-foreground tracking-tight">{total}</div>
          <span className="text-[10px] text-muted-foreground">All logged operations</span>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('DELIVERED')}
          className={`text-left p-4 rounded-xl border transition-all ${
            status === 'DELIVERED' || status === 'SENT'
              ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/40 shadow-xs'
              : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Delivered
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
            {delivered}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {total > 0
              ? `${Math.round((delivered / total) * 100)}% delivery rate`
              : 'Confirmed delivered'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('PENDING')}
          className={`text-left p-4 rounded-xl border transition-all ${
            status === 'PENDING'
              ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/40 shadow-xs'
              : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              Pending Queue
            </span>
            <Clock3 className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
            {pending}
          </div>
          <span className="text-[10px] text-muted-foreground">Queued or retry backoff</span>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('FAILED')}
          className={`text-left p-4 rounded-xl border transition-all ${
            status === 'FAILED'
              ? 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/40 shadow-xs'
              : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              Failed / Dead Letter
            </span>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 tracking-tight">
            {failed}
          </div>
          <span className="text-[10px] text-muted-foreground">Permanent error or max retries</span>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('SKIPPED')}
          className={`text-left p-4 rounded-xl border transition-all col-span-2 sm:col-span-1 ${
            status === 'SKIPPED'
              ? 'bg-muted border-foreground/30 ring-1 ring-foreground/20 shadow-xs'
              : 'bg-card border-border/80 hover:border-border hover:bg-muted/30 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              Suppressed / Skipped
            </span>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-black text-foreground tracking-tight">{skipped}</div>
          <span className="text-[10px] text-muted-foreground">Quiet hours or rate limits</span>
        </button>
      </div>

      {/* 3. Filters & Operations Table Card */}
      <Card className="border-border/80 shadow-xs bg-card overflow-hidden">
        <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/60">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Delivery Telemetry & Queue Log
              </CardTitle>
              <CardDescription className="text-xs">
                Real-time queue tracking across all outbound notification integrations.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 self-end lg:self-auto">
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

            <Select value={status} onValueChange={setStatus}>
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

            <div className="flex items-center gap-1.5 sm:col-span-2 lg:col-span-1">
              <Input
                aria-label="From date"
                type="date"
                className="text-xs h-8 bg-background border-border/80 w-1/2"
                value={from}
                onChange={event => setFrom(event.target.value)}
                placeholder="From"
              />
              <Input
                aria-label="To date"
                type="date"
                className="text-xs h-8 bg-background border-border/80 w-1/2"
                value={to}
                onChange={event => setTo(event.target.value)}
                placeholder="To"
              />
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
                  <TableHead className="text-xs font-bold text-foreground py-3">Status</TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Channel & Category
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Masked Destination
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Trigger Source
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Attempts & Latency
                  </TableHead>
                  <TableHead className="text-xs font-bold text-foreground py-3">
                    Timestamp
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
                ) : rows.length === 0 ? (
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
                  rows.map(row => {
                    const isDelivered = row.status === 'SENT' || row.status === 'DELIVERED';
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

                        <TableCell className="py-3">
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
                              className="mt-1 max-w-xs text-[11px] text-rose-600 dark:text-rose-400 bg-rose-500/5 px-2 py-0.5 rounded border border-rose-500/20"
                              title={row.errorMsg}
                            >
                              {row.errorMsg}
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="font-mono text-xs py-3">
                          <span className="bg-muted/50 text-foreground px-2 py-0.5 rounded-md border border-border/50 text-[11px]">
                            {row.recipientDisplay || 'Encrypted Recipient'}
                          </span>
                        </TableCell>

                        <TableCell className="py-3">
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

                        <TableCell className="py-3">
                          <div className="text-xs font-mono tabular-nums font-semibold text-foreground">
                            {row.attempts} / {row.maxAttempts}
                          </div>
                          {row.lastAttempt && (
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {row.lastAttempt.latencyMs}ms latency
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="whitespace-nowrap text-xs py-3 text-muted-foreground">
                          <div>{formatTimestamp(row.createdAt)}</div>
                          {row.status === 'PENDING' && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400">
                              Next: {formatTimestamp(row.nextAttemptAt)}
                            </div>
                          )}
                        </TableCell>

                        {canRetry && (
                          <TableCell className="text-right py-3">
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
        </CardContent>
      </Card>

      {hasMore && cursor && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void fetchOperations(cursor)}
            className="text-xs font-semibold gap-1.5 border-border/80"
          >
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Load More Deliveries
          </Button>
        </div>
      )}
    </div>
  );
}
