'use client';

import { useCallback, useState } from 'react';
import {
  Activity,
  BarChart3,
  BellRing,
  FlaskConical,
  Gauge,
  Layers,
  Loader2,
  PauseCircle,
  PlayCircle,
  Radio,
  ServerCog,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Switch } from '@/components/ui/shadcn/switch';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import NotificationCapacityOverview from '@/components/settings/NotificationCapacityOverview';
import ProviderCapacitySettings from '@/components/settings/ProviderCapacitySettings';
import NotificationOperations from '@/components/settings/NotificationOperations';
import DeliveryStatusCards from '@/components/settings/notifications/DeliveryStatusCards';

// ─── Types (mirrors page.tsx) ─────────────────────────────────────────────────

type Capacity = {
  provider?: string;
  channel: string;
  configuredRatePerSecond: number;
  effectiveRatePerSecond: number;
  bulkRatePerSecond: number;
  maxInFlight: number;
  bulkMaxInFlight?: number;
  adaptiveBackpressure: boolean;
  bulkShare?: number;
  mode?: string;
  source?: string;
  revision?: number | null;
};

type Runtime = {
  bulkQueueLowWatermark: number;
  bulkQueueHighWatermark: number;
  defaultBulkSharePercent: number;
  adaptiveBackpressure: boolean;
  revision: number;
  updatedAt: string;
} | null;

type Watermarks = {
  low: number;
  high: number;
  source: string;
  revision: number | null;
  defaultBulkSharePercent?: number;
  adaptiveBackpressure?: boolean;
};

type QueueHealth = {
  depth: number;
  low: number;
  high: number;
  source: string;
  revision: number | null;
  state: 'NORMAL' | 'PAUSED';
  hasCapacity: boolean;
} | null;

type SubscriptionState = {
  state: string;
  _count: { _all: number };
};

type FeedbackType = {
  eventType: string;
  count: number;
};

type Campaign = {
  id: string;
  sourceType: string;
  status: string;
  materializedTargets: number;
  completedTargets: number;
  failedTargets: number;
};

export type NotificationOperationsPageProps = {
  capacities: Capacity[];
  workerCount: number;
  campaigns: Campaign[];
  initialPaused: boolean;
  canManage: boolean;
  watermarks: Watermarks;
  runtime: Runtime;
  queueHealth: QueueHealth;
  subscriptionStates: SubscriptionState[];
  feedbackTypes: FeedbackType[];
  userRole: 'ADMIN' | 'AUDITOR';
};

// ─── Summary strip ─────────────────────────────────────────────────────────────

function SummaryStrip({
  queueHealth,
  workerCount,
  initialPaused,
  canManage,
  autoRefresh,
  onAutoRefreshChange,
}: {
  queueHealth: QueueHealth;
  workerCount: number;
  initialPaused: boolean;
  canManage: boolean;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
}) {
  const [paused, setPaused] = useState(initialPaused);
  const [saving, setSaving] = useState(false);

  const togglePause = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/notifications/capacity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulkPaused: !paused }),
      });
      if (res.ok) setPaused(v => !v);
    } finally {
      setSaving(false);
    }
  };

  const queueStateColor =
    queueHealth?.state === 'PAUSED'
      ? 'text-amber-600 dark:text-amber-400'
      : queueHealth?.hasCapacity
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-muted/40 border border-border/80 px-4 py-3 text-xs">
      {/* Left: telemetry strip */}
      <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
        {/* Queue depth */}
        {queueHealth && (
          <div className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 shrink-0" />
            <span>
              Queue:{' '}
              <strong className={`font-bold ${queueStateColor}`}>
                {queueHealth.depth.toLocaleString()}
              </strong>{' '}
              pending
            </span>
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase tracking-wider ${
                queueHealth.state === 'PAUSED'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : queueHealth.hasCapacity
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
            >
              {queueHealth.state === 'PAUSED'
                ? 'Backpressure'
                : queueHealth.hasCapacity
                  ? 'Healthy'
                  : 'Throttled'}
            </Badge>
          </div>
        )}

        {/* Workers */}
        <div className="flex items-center gap-1.5">
          <ServerCog className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span>
            <strong className="font-bold text-foreground">{workerCount}</strong> worker leases
          </span>
        </div>

        {/* Bulk pause toggle — admin only */}
        {canManage && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => void togglePause()}
              className={`h-7 text-[10px] font-bold gap-1 ${
                paused
                  ? 'border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-500/30 hover:bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : paused ? (
                <PlayCircle className="h-3 w-3" />
              ) : (
                <PauseCircle className="h-3 w-3" />
              )}
              {paused ? 'Resume Bulk' : 'Pause Bulk'}
            </Button>
          </div>
        )}

        {/* Privacy assurance */}
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span>Recipient masking · Secrets never exposed</span>
        </div>
      </div>

      {/* Right: auto-refresh */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-muted-foreground hidden sm:inline">
          Auto-refresh (15s)
        </span>
        <Switch checked={autoRefresh} onCheckedChange={onAutoRefreshChange} />
      </div>
    </div>
  );
}

// ─── Main page component ───────────────────────────────────────────────────────

export default function NotificationOperationsPage({
  capacities,
  workerCount,
  campaigns,
  initialPaused,
  canManage,
  watermarks,
  runtime,
  queueHealth,
  subscriptionStates,
  feedbackTypes,
  userRole,
}: NotificationOperationsPageProps) {
  // Shared auto-refresh state: drives polling in NotificationOperations
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Status filter state shared between Overview cards and Delivery Log
  // When a card is clicked on Overview, we switch to the delivery tab with that status pre-set.
  const [activeStatus, setActiveStatus] = useState('all');

  // Pending stats from the delivery log (updated via callback when data loads)
  const [deliveryStats, setDeliveryStats] = useState<Record<string, number>>({});

  const handleStatusCardClick = useCallback((status: string) => {
    setActiveStatus(status);
    // Switch to delivery log tab so the filter takes effect immediately
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('tab', 'delivery');
      const qs = params.toString();
      window.history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      );
      // Force React to re-read URL by dispatching a popstate event
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <BarChart3 className="h-3.5 w-3.5" />,
    },
    {
      id: 'queue',
      label: 'Queue & Capacity',
      icon: <Gauge className="h-3.5 w-3.5" />,
    },
    {
      id: 'delivery',
      label: 'Delivery Log',
      icon: <Activity className="h-3.5 w-3.5" />,
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      icon: <FlaskConical className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Always-visible summary strip */}
      <SummaryStrip
        queueHealth={queueHealth}
        workerCount={workerCount}
        initialPaused={initialPaused}
        canManage={canManage}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
      />

      {/* Tab navigation */}
      <DetailTabs tabs={tabs} defaultTab="overview" syncWithUrl layout="grid">
        {/* ── Overview ─────────────────────────────────────────────────────── */}
        <DetailTabContent
          value="overview"
          className="space-y-6 focus-visible:outline-hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200"
        >
          {/* Status metric cards — click to navigate to Delivery Log with filter */}
          <div>
            <p className="text-xs text-muted-foreground mb-3">
              Click any card to jump to the{' '}
              <strong className="text-foreground">Delivery Log</strong> with that status filter
              pre-selected.
            </p>
            <DeliveryStatusCards
              stats={deliveryStats}
              activeStatus={activeStatus}
              onStatusChange={handleStatusCardClick}
            />
          </div>

          {/* Subscriber deliverability + feedback event stats */}
          {(subscriptionStates.length > 0 || feedbackTypes.length > 0) && (
            <section aria-labelledby="deliverability-heading" className="space-y-3">
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Subscriber Deliverability
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {subscriptionStates.map(item => (
                  <div key={item.state} className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {item.state.toLowerCase()}
                    </p>
                    <p className="text-2xl font-bold">{item._count._all}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Subscription state</p>
                  </div>
                ))}
                {feedbackTypes.map(item => (
                  <div key={item.eventType} className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      24h {item.eventType.toLowerCase()}
                    </p>
                    <p className="text-2xl font-bold">{item.count}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Provider feedback</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Fanout campaign progress */}
          {campaigns.length > 0 && (
            <section aria-labelledby="fanout-heading" className="space-y-3">
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Active Fanout Campaigns
              </h2>
              <div className="space-y-2">
                {campaigns.map(campaign => {
                  const attempted = campaign.materializedTargets + campaign.failedTargets;
                  const percent =
                    attempted === 0 ? 0 : Math.round((campaign.completedTargets / attempted) * 100);
                  return (
                    <div key={campaign.id} className="rounded-lg border border-border/70 p-3">
                      <div className="flex justify-between text-sm">
                        <span>{campaign.sourceType.replaceAll('_', ' ')}</span>
                        <Badge variant="outline">{campaign.status}</Badge>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {campaign.materializedTargets} queued · {campaign.completedTargets}{' '}
                        delivered · {campaign.failedTargets} failed · {percent}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Quick navigation links */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" asChild className="text-xs gap-1.5 h-8">
              <Link href="/settings/notifications/operations?tab=delivery">
                <Activity className="h-3.5 w-3.5" />
                Go to Delivery Log
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild className="text-xs gap-1.5 h-8">
              <Link href="/settings/notifications/operations?tab=queue">
                <Gauge className="h-3.5 w-3.5" />
                Manage Queue & Capacity
              </Link>
            </Button>
            {canManage && (
              <Button variant="outline" size="sm" asChild className="text-xs gap-1.5 h-8">
                <Link href="/settings/notifications">
                  <BellRing className="h-3.5 w-3.5" />
                  Configure Providers
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild className="text-xs gap-1.5 h-8">
              <Link href="/settings/notifications/history">
                <Radio className="h-3.5 w-3.5" />
                Delivery History
              </Link>
            </Button>
          </div>
        </DetailTabContent>

        {/* ── Queue & Capacity ─────────────────────────────────────────────── */}
        <DetailTabContent
          value="queue"
          className="space-y-6 focus-visible:outline-hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200"
        >
          {!canManage && (
            <div className="flex items-center gap-2 rounded-xl bg-muted/40 border border-border/80 px-4 py-3 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>
                <strong className="text-foreground">Auditor read-only view.</strong> Queue settings
                and capacity are visible but cannot be modified.
              </span>
            </div>
          )}

          <NotificationCapacityOverview
            capacities={capacities}
            workerCount={workerCount}
            campaigns={[]}
            initialPaused={initialPaused}
            canManage={canManage}
            watermarks={watermarks}
            queueHealth={queueHealth}
            runtime={runtime}
          />

          {canManage && (
            <section aria-labelledby="channel-capacity-heading" className="space-y-3">
              <h2 id="channel-capacity-heading" className="text-sm font-bold tracking-tight">
                Channel Capacity — Slack &amp; Webhook
              </h2>
              <p className="text-xs text-muted-foreground">
                Logical profiles governing per-origin delivery buckets. No credential card required.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <ProviderCapacitySettings providerKey="slack" />
                <ProviderCapacitySettings providerKey="webhook" />
              </div>
            </section>
          )}
        </DetailTabContent>

        {/* ── Delivery Log ─────────────────────────────────────────────────── */}
        <DetailTabContent
          value="delivery"
          className="focus-visible:outline-hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200"
        >
          <NotificationOperations
            canRetry={canManage}
            autoRefresh={autoRefresh}
            initialStatus={activeStatus}
            onStatsChange={setDeliveryStats}
          />
        </DetailTabContent>

        {/* ── Diagnostics ──────────────────────────────────────────────────── */}
        <DetailTabContent
          value="diagnostics"
          className="space-y-6 focus-visible:outline-hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200"
        >
          {/* Worker health */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
              <ServerCog className="h-4 w-4 text-primary" />
              Worker Fleet
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Active Worker Leases
                </p>
                <p className="text-2xl font-bold">{workerCount}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Distributed reservations · TTL-based
                </p>
              </div>
              {queueHealth && (
                <>
                  <div className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Queue Depth
                    </p>
                    <p className="text-2xl font-bold">{queueHealth.depth.toLocaleString()}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Low: {queueHealth.low.toLocaleString()} · High:{' '}
                      {queueHealth.high.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Queue State
                    </p>
                    <p
                      className={`text-2xl font-bold ${
                        queueHealth.state === 'PAUSED'
                          ? 'text-amber-600 dark:text-amber-400'
                          : queueHealth.hasCapacity
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {queueHealth.state === 'PAUSED'
                        ? 'Paused'
                        : queueHealth.hasCapacity
                          ? 'Healthy'
                          : 'Throttled'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Source: {queueHealth.source} · Rev {queueHealth.revision ?? '—'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Provider feedback events */}
          {feedbackTypes.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Provider Feedback — Last 24h
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {feedbackTypes.map(item => (
                  <div key={item.eventType} className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {item.eventType.toLowerCase().replaceAll('_', ' ')}
                    </p>
                    <p className="text-2xl font-bold">{item.count}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Provider feedback events
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Capacity source audit */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" />
              Capacity Source Audit
            </h2>
            <p className="text-xs text-muted-foreground">
              DB rows take precedence over ENV and DEFAULT. Workers refresh within ~5s via TTL.
            </p>
            <div className="rounded-xl border border-border/80 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/60">
                    <th className="text-left px-4 py-2.5 font-semibold">Channel</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Provider</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Source</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Rate / sec</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Bulk Rate</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Adaptive</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Rev</th>
                  </tr>
                </thead>
                <tbody>
                  {capacities.map((item, idx) => (
                    <tr
                      key={`${item.channel}:${item.provider ?? 'default'}`}
                      className={`border-b border-border/40 ${idx % 2 === 0 ? 'bg-card' : 'bg-muted/10'}`}
                    >
                      <td className="px-4 py-2.5 font-medium">{item.channel}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px]">
                        {item.provider ?? 'default'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            item.source === 'DATABASE'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : item.source === 'ENV'
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                : 'border-border/80 bg-muted text-muted-foreground'
                          }`}
                        >
                          {item.source ?? 'DEFAULT'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        {item.effectiveRatePerSecond}/s
                        {item.effectiveRatePerSecond !== item.configuredRatePerSecond && (
                          <span className="text-muted-foreground ml-1">
                            (cfg: {item.configuredRatePerSecond}/s)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono">{item.bulkRatePerSecond}/s</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            item.adaptiveBackpressure
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-muted-foreground'
                          }
                        >
                          {item.adaptiveBackpressure ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">
                        {item.revision ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Role note */}
          <div className="flex items-center gap-2.5 rounded-xl bg-muted/40 border border-border/80 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>
              <strong className="text-foreground">
                {userRole === 'ADMIN' ? 'Administrator Control Plane:' : 'Auditor Telemetry View:'}
              </strong>{' '}
              Delivery metadata is tracked with recipient masking and redacted error payloads.
              Secrets are never exposed.
            </span>
          </div>
        </DetailTabContent>
      </DetailTabs>
    </div>
  );
}
