import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import NotificationOperations from '@/components/settings/NotificationOperations';
import { getCurrentUser } from '@/lib/rbac';
import { Activity, BellRing, Radio } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import NotificationCapacityOverview from '@/components/settings/NotificationCapacityOverview';
import ProviderCapacitySettings from '@/components/settings/ProviderCapacitySettings';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getEffectiveCapacity, getEffectiveWatermarks } from '@/lib/notification-capacity/resolver';
import { getBulkQueueHealth } from '@/lib/notification-fanout';

export default async function NotificationOperationsPage() {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    redirect('/login');
  }

  if (user.role !== 'ADMIN' && user.role !== 'AUDITOR') {
    redirect('/settings');
  }
  const channels = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'SLACK', 'WEBHOOK'] as const;
  const [leases, campaigns, control, subscriptionStates, feedbackTypes, runtime, storedProviderCapacities, configuredProviders] = await Promise.all([
    prisma.providerWorkerLease.count({ where: { expiresAt: { gt: new Date() } } }),
    prisma.notificationFanout.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        sourceType: true,
        status: true,
        materializedTargets: true,
        completedTargets: true,
        failedTargets: true,
      },
    }),
    prisma.systemConfig.findUnique({ where: { key: 'notification_capacity_control' } }),
    prisma.statusPageSubscription.groupBy({ by: ['state'], _count: { _all: true } }),
    prisma.$queryRaw<Array<{ eventType: string; count: number }>>(Prisma.sql`
      SELECT "eventType", COUNT(*)::integer AS "count"
      FROM "NotificationProviderFeedback"
      WHERE "occurredAt" >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
      GROUP BY "eventType"
    `),
    prisma.notificationRuntimeSettings.findUnique({ where: { id: 'default' } }),
    prisma.notificationProviderCapacity.findMany({ orderBy: [{ channel: 'asc' }, { provider: 'asc' }] }),
    prisma.notificationProvider.findMany({ select: { provider: true, enabled: true } }),
  ]);
  // Union inventory: configured providers + stored rows + synthetic channel defaults.
  // Never hide channels. Stored rows authoritative; actual enabled providers (e.g. ses without
  // DB row + ENV override) must still appear as EMAIL:ses, not collapsed to EMAIL:default.
  // WEBHOOK:default / SLACK:default are logical profiles governing per-origin buckets.
  const providerToChannel: Record<string, (typeof channels)[number]> = {
    resend: 'EMAIL',
    sendgrid: 'EMAIL',
    ses: 'EMAIL',
    smtp: 'EMAIL',
    twilio: 'SMS',
    'aws-sns': 'SMS',
    'web-push': 'PUSH',
  };
  const seen = new Set(storedProviderCapacities.map(r => `${r.channel}:${r.provider}`));
  const inventory: Array<{ channel: (typeof channels)[number]; provider: string }> = [
    ...storedProviderCapacities.map(r => ({ channel: r.channel as (typeof channels)[number], provider: r.provider })),
  ];
  // Expand from actually configured providers
  for (const rec of configuredProviders) {
    if (!rec.enabled) continue;
    const ch = providerToChannel[rec.provider];
    if (!ch) continue;
    const key = `${ch}:${rec.provider}`;
    if (!seen.has(key)) {
      seen.add(key);
      inventory.push({ channel: ch, provider: rec.provider });
    }
    if (rec.provider === 'twilio') {
      const wKey = 'WHATSAPP:twilio';
      if (!seen.has(wKey)) {
        seen.add(wKey);
        inventory.push({ channel: 'WHATSAPP', provider: 'twilio' });
      }
    }
  }
  for (const channel of channels) {
    const hasChannel = inventory.some(r => r.channel === channel);
    if (!hasChannel) {
      const key = `${channel}:default`;
      if (!seen.has(key)) {
        seen.add(key);
        inventory.push({ channel, provider: 'default' });
      }
    }
  }
  // Ensure logical defaults exist even when channel already has a specific provider
  for (const ch of ['SLACK', 'WEBHOOK'] as const) {
    const key = `${ch}:default`;
    if (!seen.has(key)) {
      seen.add(key);
      inventory.push({ channel: ch, provider: 'default' });
    }
  }
  const [effectiveCapacities, watermarks, queueHealth] = await Promise.all([
    Promise.all(inventory.map(({ channel, provider }) => getEffectiveCapacity({ channel: channel as never, provider }))),
    getEffectiveWatermarks(),
    getBulkQueueHealth(),
  ]);
  const controlValue =
    control?.value && typeof control.value === 'object' && !Array.isArray(control.value)
      ? (control.value as Record<string, unknown>)
      : {};

  return (
    <div className="space-y-6">
      {/* 1. Simple Grey Shaded Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: user.role === 'ADMIN' ? 'Notification Providers' : 'Settings',
          href: user.role === 'ADMIN' ? '/settings/notifications' : '/settings',
          current: 'Operations',
        }}
        tag="Delivery Control Plane"
        title="Notification Operations"
        subtitle="Real-time delivery telemetry, queue health, error diagnostics, and recovery engine for all alert channels."
        icon={
          <div className="p-3 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 shadow-inner">
            <Activity className="h-7 w-7" />
          </div>
        }
        badges={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Live Telemetry
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-xs font-semibold"
            >
              {user.role === 'ADMIN' ? 'Admin Full Control' : 'Auditor Read-Only'}
            </Badge>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {user.role === 'ADMIN' && (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
              >
                <Link href="/settings/notifications">
                  <BellRing className="h-3.5 w-3.5" />
                  Configure Providers
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
            >
              <Link href="/settings/notifications/history">
                <Radio className="h-3.5 w-3.5" />
                Delivery History
              </Link>
            </Button>
          </div>
        }
      />

      <NotificationCapacityOverview
        capacities={effectiveCapacities.map(c => ({
          provider: c.provider,
          channel: c.channel,
          configuredRatePerSecond: c.configuredRatePerSecond,
          effectiveRatePerSecond: c.effectiveRatePerSecond,
          bulkRatePerSecond: c.bulkRatePerSecond,
          maxInFlight: c.maxInFlight,
          bulkMaxInFlight: c.bulkMaxInFlight,
          adaptiveBackpressure: c.adaptiveBackpressure,
          bulkShare: c.bulkShare,
          mode: c.mode,
          source: c.source,
          revision: c.revision,
        }))}
        workerCount={leases}
        campaigns={campaigns}
        initialPaused={controlValue.bulkPaused === true}
        canManage={user.role === 'ADMIN'}
        watermarks={watermarks}
        queueHealth={queueHealth}
        runtime={
          runtime
            ? {
                bulkQueueLowWatermark: runtime.bulkQueueLowWatermark,
                bulkQueueHighWatermark: runtime.bulkQueueHighWatermark,
                defaultBulkSharePercent: runtime.defaultBulkSharePercent,
                adaptiveBackpressure: runtime.adaptiveBackpressure,
                revision: runtime.revision,
                updatedAt: runtime.updatedAt.toISOString(),
              }
            : null
        }
      />
      {user.role === 'ADMIN' ? (
        <section aria-labelledby="channel-capacity-heading" className="space-y-3">
          <h2 id="channel-capacity-heading" className="text-sm font-bold tracking-tight">Channel capacity &mdash; Slack &amp; Webhook</h2>
          <p className="text-xs text-muted-foreground">Logical profiles governing per-origin buckets. No credential card required.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <ProviderCapacitySettings providerKey="slack" />
            <ProviderCapacitySettings providerKey="webhook" />
          </div>
        </section>
      ) : null}
      <section aria-labelledby="deliverability-heading" className="grid gap-3 md:grid-cols-3">
        <h2 id="deliverability-heading" className="sr-only">Subscriber deliverability</h2>
        {subscriptionStates.map(item => (
          <div key={item.state} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{item.state.toLowerCase()}</p>
            <p className="text-2xl font-bold">{item._count._all}</p>
          </div>
        ))}
        {feedbackTypes.map(item => (
          <div key={item.eventType} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">24h {item.eventType.toLowerCase()}</p>
            <p className="text-2xl font-bold">{item.count}</p>
          </div>
        ))}
      </section>
      <NotificationOperations canRetry={user.role === 'ADMIN'} />
    </div>
  );
}
