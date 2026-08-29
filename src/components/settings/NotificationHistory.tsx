'use client';

import { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
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
  Mail,
  MessageSquare,
  Smartphone,
  Hash,
  Webhook,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  MinusCircle,
} from 'lucide-react';
import Link from 'next/link';

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
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
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

  const fetchNotifications = async (options?: { refresh?: boolean }) => {
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
      setLastUpdated(new Date().toLocaleTimeString());
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
  };

  useEffect(() => {
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, filterChannel, filterStatus, debouncedQuery, fromDate, toDate]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 350);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    setOffset(0);
  }, [filterChannel, filterStatus, debouncedQuery, fromDate, toDate]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
        return (
          <Badge variant="success" size="xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Sent
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge variant="warning" size="xs">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="danger" size="xs">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'SKIPPED':
        return (
          <Badge variant="outline" size="xs">
            <MinusCircle className="h-3 w-3 mr-1" />
            Skipped
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" size="xs">
            {status}
          </Badge>
        );
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'EMAIL':
        return <Mail className="h-4 w-4" />;
      case 'SMS':
        return <MessageSquare className="h-4 w-4" />;
      case 'PUSH':
        return <Smartphone className="h-4 w-4" />;
      case 'SLACK':
        return <Hash className="h-4 w-4" />;
      case 'WEBHOOK':
        return <Webhook className="h-4 w-4" />;
      case 'WHATSAPP':
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Notifications</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">
              {filterChannel === 'all' ? 'All channels' : `Channel: ${filterChannel}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sent</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
            <p className="text-xs text-muted-foreground">Delivered successfully</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Queued or processing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
            <p className="text-xs text-muted-foreground">Delivery errors</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Skipped</CardTitle>
            <MinusCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold">{stats.skipped}</div>
            <p className="text-xs text-muted-foreground">Terminal policy outcomes</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <CardTitle>Notification History</CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-[220px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search incidents or messages"
                  className="pl-9"
                  aria-label="Search notifications"
                />
              </div>
              <Input
                type="date"
                value={fromDate}
                onChange={event => setFromDate(event.target.value)}
                className="w-[150px]"
              />
              <Input
                type="date"
                value={toDate}
                onChange={event => setToDate(event.target.value)}
                className="w-[150px]"
              />
              <Select
                value={filterChannel}
                onValueChange={v => {
                  setFilterChannel(v);
                  setOffset(0);
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="PUSH">Push</SelectItem>
                  <SelectItem value="SLACK">Slack</SelectItem>
                  <SelectItem value="WEBHOOK">Webhook</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filterStatus}
                onValueChange={v => {
                  setFilterStatus(v);
                  setOffset(0);
                }}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="SKIPPED">Skipped</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNotifications({ refresh: true })}
                disabled={loading || refreshing}
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-2">Refresh</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setDebouncedQuery('');
                  setFromDate('');
                  setToDate('');
                  setFilterChannel('all');
                  setFilterStatus('all');
                }}
              >
                Reset
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Total: {total} notifications</span>
            {filterStatus !== 'all' && <span>Status filter: {filterStatus}</span>}
            {lastUpdated && <span>Last updated: {lastUpdated}</span>}
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : errorMessage ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">{errorMessage}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNotifications({ refresh: true })}
                className="mt-3"
              >
                Try again
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-1">No notifications found</h3>
              <p className="text-sm text-muted-foreground">
                Try adjusting the filters or refresh the list.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Incident</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifications.map(notification => (
                      <TableRow key={notification.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getChannelIcon(notification.channel)}
                            <span className="font-medium">{notification.channel}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(notification.status)}</TableCell>
                        <TableCell>
                          {notification.incident ? (
                            <Link
                              className="text-primary hover:underline font-medium"
                              href={`/incidents/${notification.incident.id}`}
                            >
                              {notification.incident.title}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {notification.createdAt}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {notification.deliveredAt ||
                            notification.sentAt ||
                            notification.failedAt ||
                            '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {notification.latencyMs !== null
                            ? formatDuration(notification.latencyMs)
                            : notification.pendingForMs !== null
                              ? `Pending ${formatDuration(notification.pendingForMs)}`
                              : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {notification.attempts}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div
                            className="max-w-[280px]"
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                            title={notification.message || ''}
                          >
                            {notification.message || '-'}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="max-w-[320px] whitespace-pre-wrap break-words font-mono text-xs">
                            {notification.errorMsg || '-'}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={offset === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOffset(offset + limit)}
                    disabled={offset + limit >= total}
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
