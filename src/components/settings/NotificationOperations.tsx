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
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
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

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'outline' {
  if (status === 'SENT' || status === 'DELIVERED') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'FAILED') return 'danger';
  return 'outline';
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
        setStats(body.stats.byStatus);
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

  return (
    <div className="space-y-5">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{canRetry ? 'Administrator control' : 'Auditor read-only access'}</AlertTitle>
        <AlertDescription>
          This workspace view contains delivery metadata only. Message bodies and destination
          secrets remain encrypted at rest and are never returned by the operations API.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['Total', total, Activity, 'text-foreground'],
            ['Delivered', delivered, CheckCircle2, 'text-emerald-600'],
            ['Pending', stats.PENDING || 0, Clock3, 'text-amber-600'],
            ['Failed', stats.FAILED || 0, AlertTriangle, 'text-red-600'],
          ] as const
        ).map(([label, value, Icon, color]) => (
          <Card key={String(label)}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{String(label)}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent className={`text-2xl font-bold ${color}`}>{String(value)}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div className="relative xl:col-span-2">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search delivery operations"
            className="pl-9"
            placeholder="Search source, incident, or masked recipient"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger aria-label="Filter by channel">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {CHANNELS.map(value => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map(value => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map(value => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void fetchOperations()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
        <Input
          aria-label="From date"
          type="date"
          value={from}
          onChange={event => setFrom(event.target.value)}
        />
        <Input
          aria-label="To date"
          type="date"
          value={to}
          onChange={event => setTo(event.target.value)}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Delivery operations unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created</TableHead>
              {canRetry && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={canRetry ? 7 : 6} className="h-28 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  <span className="sr-only">Loading notification operations</span>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canRetry ? 7 : 6}
                  className="h-28 text-center text-muted-foreground"
                >
                  No deliveries match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant={statusVariant(row.status)} size="xs">
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.channel}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.category} · {row.templateKey || 'unspecified'}
                    </div>
                    {row.errorMsg && (
                      <div className="mt-1 max-w-72 text-xs text-destructive" title={row.errorMsg}>
                        {row.errorMsg}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.recipientDisplay || 'Legacy recipient'}
                  </TableCell>
                  <TableCell>
                    <div
                      className="max-w-56 truncate text-sm"
                      title={row.incident?.title || row.sourceType || undefined}
                    >
                      {row.incident?.title || row.sourceType || '—'}
                    </div>
                    <div className="max-w-56 truncate text-xs text-muted-foreground">
                      {row.sourceType}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="tabular-nums">
                      {row.attempts}/{row.maxAttempts}
                    </span>
                    {row.lastAttempt && (
                      <div className="text-xs text-muted-foreground">
                        {row.lastAttempt.latencyMs} ms
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatTimestamp(row.createdAt)}
                    {row.status === 'PENDING' && (
                      <div className="text-muted-foreground">
                        Next: {formatTimestamp(row.nextAttemptAt)}
                      </div>
                    )}
                  </TableCell>
                  {canRetry && (
                    <TableCell className="text-right">
                      {row.status === 'FAILED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retryingId === row.id}
                          onClick={() => void retry(row.id)}
                        >
                          {retryingId === row.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <RotateCcw />
                          )}{' '}
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && cursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void fetchOperations(cursor)}
          >
            {loadingMore && <Loader2 className="animate-spin" />}Load more
          </Button>
        </div>
      )}
    </div>
  );
}
