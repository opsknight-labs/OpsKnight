'use client';

import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
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
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import {
  RefreshCw,
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  XCircle,
  MinusCircle,
  Activity,
  SlidersHorizontal,
  ExternalLink,
  AlertTriangle,
  Radio,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import {
  TwilioLogo,
  WhatsAppLogo,
  WebPushLogo,
  SmtpLogo,
} from '@/components/settings/ProviderBrandLogos';

type Notification = {
  id: string;
  channel: string;
  status: string;
  message: string | null;
  incident: {
    id: string;
    title: string;
    status: string;
    urgency: string;
  } | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  errorMsg: string | null;
  attempts: number;
  latencyMs: number | null;
  pendingForMs: number | null;
  createdAt: string;
};

export default function NotificationHistory() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [stats, setStats] = useState({
    total: 0,
    sent: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
  });

  const resolveDateToIso = (value: string, endOfDay: boolean) => {
    if (!value) return null;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const formatDuration = (durationMs: number) => {
    const totalSeconds = Math.floor(durationMs / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const fetchNotifications = useCallback(
    async (options?: { refresh?: boolean }) => {
      try {
        if (options?.refresh && notifications.length > 0) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setErrorMessage('');
        const params = new URLSearchParams({
          limit: limit.toString(),
          offset: offset.toString(),
        });
        if (filterChannel && filterChannel !== 'all') params.set('channel', filterChannel);
        if (filterStatus && filterStatus !== 'all') params.set('status', filterStatus);
        if (debouncedQuery) params.set('q', debouncedQuery);
        const fromIso = resolveDateToIso(fromDate, false);
        const toIso = resolveDateToIso(toDate, true);
        if (fromIso) params.set('from', fromIso);
        if (toIso) params.set('to', toIso);

        const response = await fetch(`/api/notifications/history?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Failed to fetch notifications');
        }

        const data = await response.json();
        setNotifications(data.notifications || []);
        setTotal(data.total || 0);
        setStats(
          data.stats || {
            total: 0,
            sent: 0,
            pending: 0,
            failed: 0,
            skipped: 0,
          }
        );
      } catch (error) {
        setErrorMessage('Unable to load notification history.');
        if (error instanceof Error) {
          logger.error('Error fetching notification history', { error: error.message });
        } else {
          logger.error('Error fetching notification history', { error: String(error) });
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      debouncedQuery,
      filterChannel,
      filterStatus,
      fromDate,
      limit,
      notifications.length,
      offset,
      toDate,
    ]
  );

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 350);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const handleStatusFilterClick = (targetStatus: string) => {
    if (filterStatus === targetStatus) {
      setFilterStatus('all');
    } else {
      setFilterStatus(targetStatus);
    }
    setOffset(0);
  };

  const applyDatePreset = (preset: 'today' | '7d' | '30d') => {
    if (datePreset === preset) {
      setDatePreset(null);
      setFromDate('');
      setToDate('');
      setOffset(0);
      return;
    }
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
    setDatePreset(preset);
    setFromDate(fromStr);
    setToDate(toStr);
    setOffset(0);
  };

  const exportCsv = () => {
    const headers = [
      'ID',
      'Channel',
      'Status',
      'Incident',
      'Attempts',
      'Latency(ms)',
      'Dispatched At',
      'Error',
    ];
    const csvRows = [
      headers,
      ...notifications.map(n => [
        n.id,
        n.channel,
        n.status,
        n.incident?.title || 'General Alert',
        n.attempts,
        n.latencyMs ?? '',
        n.deliveredAt || n.sentAt || n.failedAt || n.createdAt,
        n.errorMsg || '',
      ]),
    ];
    const csv = csvRows
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-notification-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
      case 'DELIVERED':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {status}
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 inline-flex items-center gap-1"
          >
            <Clock3 className="h-3 w-3 animate-pulse" />
            {status}
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 inline-flex items-center gap-1"
          >
            <AlertTriangle className="h-3 w-3" />
            {status}
          </Badge>
        );
      case 'SKIPPED':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border-border/80 inline-flex items-center gap-1"
          >
            <MinusCircle className="h-3 w-3" />
            Skipped
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border-border/80"
          >
            {status}
          </Badge>
        );
    }
  };

  const getChannelIcon = (channel: string) => {
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
        return <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />;
      case 'WEBHOOK':
      default:
        return <Radio className="h-3.5 w-3.5 text-amber-500" />;
    }
  };

  const hasActiveFilters =
    filterChannel !== 'all' ||
    filterStatus !== 'all' ||
    searchQuery.trim() !== '' ||
    fromDate !== '' ||
    toDate !== '';

  return (
    <div className="space-y-6">
      {/* 1. Interactive Metric Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => handleStatusFilterClick('all')}
          className={`text-left rounded-xl border p-4 transition-all ${
            filterStatus === 'all'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30 shadow-xs'
              : 'border-border/80 bg-card hover:bg-muted/40 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium text-muted-foreground">Total Dispatched</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold text-foreground tracking-tight">{stats.total}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">All outbound attempts</p>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('SENT')}
          className={`text-left rounded-xl border p-4 transition-all ${
            filterStatus === 'SENT'
              ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30 shadow-xs'
              : 'border-border/80 bg-card hover:bg-muted/40 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Delivered
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">
            {stats.sent}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {stats.total > 0
              ? `${Math.round((stats.sent / stats.total) * 100)}% delivery rate`
              : 'Confirmed delivered'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('PENDING')}
          className={`text-left rounded-xl border p-4 transition-all ${
            filterStatus === 'PENDING'
              ? 'border-amber-500 bg-amber-500/5 ring-1 ring-amber-500/30 shadow-xs'
              : 'border-border/80 bg-card hover:bg-muted/40 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Pending Queue
            </span>
            <Clock3 className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tracking-tight">
            {stats.pending}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Queued or retry backoff</p>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('FAILED')}
          className={`text-left rounded-xl border p-4 transition-all ${
            filterStatus === 'FAILED'
              ? 'border-rose-500 bg-rose-500/5 ring-1 ring-rose-500/30 shadow-xs'
              : 'border-border/80 bg-card hover:bg-muted/40 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
              Failed / Dead Letter
            </span>
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight">
            {stats.failed}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Delivery errors</p>
        </button>

        <button
          type="button"
          onClick={() => handleStatusFilterClick('SKIPPED')}
          className={`text-left rounded-xl border p-4 transition-all ${
            filterStatus === 'SKIPPED'
              ? 'border-border bg-muted/60 ring-1 ring-border shadow-xs'
              : 'border-border/80 bg-card hover:bg-muted/40 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-medium text-muted-foreground">Suppressed / Skipped</span>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold text-foreground tracking-tight">{stats.skipped}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Quiet hours or rate limits</p>
        </button>
      </div>

      {/* 2. Main History Card & Telemetry Table */}
      <Card className="border-border/80 shadow-xs bg-card overflow-hidden">
        <CardHeader className="p-4 sm:p-5 border-b border-border/60 bg-muted/20">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Delivery Audit Stream
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Showing notification history for your account only — not workspace-wide. Includes
                all channels sent to your registered contacts.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={notifications.length === 0}
                className="h-8 text-xs font-semibold gap-1.5 border-border/80 hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNotifications({ refresh: true })}
                disabled={loading || refreshing}
                className="h-8 text-xs font-semibold gap-1.5 border-border/80 hover:bg-accent"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </Button>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setDebouncedQuery('');
                    setFromDate('');
                    setToDate('');
                    setDatePreset(null);
                    setFilterChannel('all');
                    setFilterStatus('all');
                    setOffset(0);
                  }}
                  className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Reset Filters
                </Button>
              )}
            </div>
          </div>

          {/* Multi-filter toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search incident, message..."
                className="pl-8 h-8 text-xs bg-background"
                aria-label="Search notifications"
              />
            </div>

            <Select
              value={filterChannel}
              onValueChange={v => {
                setFilterChannel(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="All Channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="SMS">SMS</SelectItem>
                <SelectItem value="PUSH">Web Push</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="SLACK">Slack</SelectItem>
                <SelectItem value="WEBHOOK">Webhook</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterStatus}
              onValueChange={v => {
                setFilterStatus(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="SENT">Delivered (SENT)</SelectItem>
                <SelectItem value="PENDING">Pending (PENDING)</SelectItem>
                <SelectItem value="FAILED">Failed (FAILED)</SelectItem>
                <SelectItem value="SKIPPED">Skipped (SKIPPED)</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                {(['today', '7d', '30d'] as const).map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyDatePreset(preset)}
                    className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                      datePreset === preset
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'bg-background border-border/80 text-muted-foreground hover:text-foreground hover:border-border'
                    }`}
                  >
                    {{ today: 'Today', '7d': 'Last 7d', '30d': 'Last 30d' }[preset]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={event => {
                    setFromDate(event.target.value);
                    setDatePreset(null);
                    setOffset(0);
                  }}
                  className="h-8 text-xs bg-background w-1/2"
                  aria-label="Start date"
                />
                <Input
                  type="date"
                  value={toDate}
                  onChange={event => {
                    setToDate(event.target.value);
                    setDatePreset(null);
                    setOffset(0);
                  }}
                  className="h-8 text-xs bg-background w-1/2"
                  aria-label="End date"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : errorMessage ? (
            <div className="p-6 text-center">
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 max-w-md mx-auto">
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {errorMessage}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNotifications({ refresh: true })}
                  className="mt-3 h-7 text-xs font-semibold"
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-16 text-center">
              <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              {hasActiveFilters ? (
                <>
                  <h3 className="text-sm font-bold text-foreground">
                    No records match your filters
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    Try adjusting your search query, channel, status, or date range.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-bold text-foreground">No notification history yet</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    You haven&apos;t received any notifications yet. Alerts are dispatched when
                    you&apos;re on-call or assigned to an active incident.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Channel breakdown bar */}
              {(() => {
                const channelCounts: Record<string, number> = {};
                for (const n of notifications) {
                  channelCounts[n.channel] = (channelCounts[n.channel] || 0) + 1;
                }
                const channelTotal = notifications.length;
                const colors: Record<string, string> = {
                  EMAIL: 'bg-blue-500',
                  SMS: 'bg-red-500',
                  PUSH: 'bg-violet-500',
                  WHATSAPP: 'bg-emerald-500',
                  SLACK: 'bg-amber-500',
                  WEBHOOK: 'bg-orange-500',
                };
                return (
                  <div className="px-4 sm:px-5 py-2.5 border-b border-border/40 bg-muted/10">
                    <div className="flex items-center gap-3">
                      <div className="flex h-1.5 flex-1 rounded-full overflow-hidden gap-px">
                        {Object.entries(channelCounts).map(([ch, count]) => (
                          <div
                            key={ch}
                            className={`${colors[ch] || 'bg-muted-foreground'} h-full`}
                            style={{ width: `${(count / channelTotal) * 100}%` }}
                            title={`${ch}: ${count}`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {Object.entries(channelCounts).map(([ch, count]) => (
                          <span
                            key={ch}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground"
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${colors[ch] || 'bg-muted-foreground'}`}
                            />
                            {ch} {Math.round((count / channelTotal) * 100)}%
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/60 bg-muted/10 hover:bg-muted/10">
                      <TableHead className="w-6 py-3" />
                      <TableHead className="text-xs font-bold text-foreground py-3">
                        Status
                      </TableHead>
                      <TableHead className="text-xs font-bold text-foreground py-3">
                        Channel
                      </TableHead>
                      <TableHead className="text-xs font-bold text-foreground py-3">
                        Incident / Context
                      </TableHead>
                      <TableHead className="text-xs font-bold text-foreground py-3">
                        Attempts & Latency
                      </TableHead>
                      <TableHead className="text-xs font-bold text-foreground py-3">
                        Dispatch Time
                      </TableHead>
                      <TableHead className="text-xs font-bold text-foreground py-3">
                        Message Preview
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifications.map(notification => (
                      <>
                        <TableRow
                          key={notification.id}
                          className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                          onClick={() =>
                            setExpandedId(expandedId === notification.id ? null : notification.id)
                          }
                        >
                          <TableCell className="py-2.5 pr-0 pl-3 w-6">
                            {expandedId === notification.id ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="py-2.5">
                            {getStatusBadge(notification.status)}
                          </TableCell>

                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-1.5">
                              {getChannelIcon(notification.channel)}
                              <span className="text-xs font-bold text-foreground">
                                {notification.channel}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell className="py-2.5">
                            {notification.incident ? (
                              <Link
                                href={`/incidents/${notification.incident.id}`}
                                className="text-xs font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1 max-w-xs truncate"
                              >
                                <span className="truncate">{notification.incident.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">General Alert</span>
                            )}
                          </TableCell>

                          <TableCell className="py-2.5">
                            <div className="text-xs font-mono tabular-nums font-semibold text-foreground">
                              {notification.attempts} attempt
                              {notification.attempts === 1 ? '' : 's'}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {notification.latencyMs !== null
                                ? `${formatDuration(notification.latencyMs)} latency`
                                : notification.pendingForMs !== null
                                  ? `Pending ${formatDuration(notification.pendingForMs)}`
                                  : '-'}
                            </div>
                          </TableCell>

                          <TableCell className="whitespace-nowrap text-xs py-2.5 text-muted-foreground">
                            <div>
                              {notification.deliveredAt ||
                                notification.sentAt ||
                                notification.failedAt ||
                                notification.createdAt}
                            </div>
                          </TableCell>

                          <TableCell className="py-2.5 max-w-sm">
                            {notification.errorMsg ? (
                              <div
                                className="truncate text-[11px] text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 flex items-center gap-1"
                                title={notification.errorMsg}
                              >
                                <AlertTriangle className="h-3 w-3 shrink-0 text-rose-500" />
                                <span className="truncate">{notification.errorMsg}</span>
                              </div>
                            ) : (
                              <div
                                className="text-xs text-muted-foreground truncate"
                                title={notification.message || ''}
                              >
                                {notification.message || '-'}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedId === notification.id && (
                          <TableRow className="bg-muted/20 border-b border-border/40">
                            <TableCell colSpan={7} className="py-3 px-5">
                              <div className="space-y-2 text-xs">
                                {notification.errorMsg && (
                                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
                                    <p className="font-semibold text-rose-600 dark:text-rose-400 mb-1 flex items-center gap-1">
                                      <AlertTriangle className="h-3.5 w-3.5" /> Error Detail
                                    </p>
                                    <p className="font-mono text-[11px] text-rose-700 dark:text-rose-300 break-all">
                                      {notification.errorMsg}
                                    </p>
                                  </div>
                                )}
                                {notification.message && (
                                  <div className="rounded-lg bg-muted/40 border border-border/60 p-3">
                                    <p className="font-semibold text-foreground mb-1">
                                      Message Preview
                                    </p>
                                    <p className="text-muted-foreground break-all font-mono text-[11px]">
                                      {notification.message}
                                    </p>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground pt-1">
                                  <span>
                                    Attempts:{' '}
                                    <strong className="text-foreground">
                                      {notification.attempts}
                                    </strong>
                                  </span>
                                  {notification.latencyMs !== null && (
                                    <span>
                                      Latency:{' '}
                                      <strong className="text-foreground">
                                        {notification.latencyMs}ms
                                      </strong>
                                    </span>
                                  )}
                                  {notification.deliveredAt && (
                                    <span>
                                      Delivered:{' '}
                                      <strong className="text-foreground">
                                        {notification.deliveredAt}
                                      </strong>
                                    </span>
                                  )}
                                  {notification.failedAt && (
                                    <span>
                                      Failed at:{' '}
                                      <strong className="text-foreground">
                                        {notification.failedAt}
                                      </strong>
                                    </span>
                                  )}
                                  {notification.incident && (
                                    <span>
                                      Incident:{' '}
                                      <Link
                                        href={`/incidents/${notification.incident.id}`}
                                        className="text-primary hover:underline font-semibold"
                                      >
                                        {notification.incident.title}
                                      </Link>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Modern Pagination Footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 bg-muted/10">
                <p className="text-xs text-muted-foreground">
                  Showing{' '}
                  <strong className="text-foreground">{total === 0 ? 0 : offset + 1}</strong> to{' '}
                  <strong className="text-foreground">{Math.min(offset + limit, total)}</strong> of{' '}
                  <strong className="text-foreground">{total}</strong> records
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={offset === 0}
                    className="h-7 text-xs font-semibold"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOffset(offset + limit)}
                    disabled={offset + limit >= total}
                    className="h-7 text-xs font-semibold"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
