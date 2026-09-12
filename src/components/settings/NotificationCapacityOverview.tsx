'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Gauge, Loader2, PauseCircle, PlayCircle, ServerCog, Users } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/shadcn/card';

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

type Watermarks = { low: number; high: number; source: string; revision: number | null };

type QueueHealth = {
  depth: number;
  low: number;
  high: number;
  source: string;
  revision: number | null;
  state: 'NORMAL' | 'PAUSED';
  hasCapacity: boolean;
} | null;

export default function NotificationCapacityOverview({
  capacities,
  workerCount,
  campaigns,
  initialPaused,
  canManage,
  watermarks,
  runtime,
  queueHealth,
}: {
  capacities: Capacity[];
  workerCount: number;
  campaigns: Array<{
    id: string;
    sourceType: string;
    status: string;
    materializedTargets: number;
    completedTargets: number;
    failedTargets: number;
  }>;
  initialPaused: boolean;
  canManage: boolean;
  watermarks?: Watermarks;
  runtime?: Runtime;
  queueHealth?: QueueHealth;
}) {
  const [paused, setPaused] = useState(initialPaused);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global runtime form state
  const [low, setLow] = useState<string>(runtime ? String(runtime.bulkQueueLowWatermark) : watermarks ? String(watermarks.low) : '5000');
  const [high, setHigh] = useState<string>(runtime ? String(runtime.bulkQueueHighWatermark) : watermarks ? String(watermarks.high) : '25000');
  const [defaultShare, setDefaultShare] = useState<number>(runtime?.defaultBulkSharePercent ?? 80);
  const [adaptive, setAdaptive] = useState<boolean>(runtime?.adaptiveBackpressure ?? true);
  const [currentRevision, setCurrentRevision] = useState<number | null>(runtime?.revision ?? watermarks?.revision ?? null);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeSuccess, setRuntimeSuccess] = useState(false);

  const sourceBadge = (source?: string) => {
    if (!source) return null;
    const variant = source === 'DATABASE' ? 'secondary' : source === 'ENV' ? 'outline' : 'outline';
    return (
      <Badge variant={variant as never} className="text-[10px] font-bold uppercase tracking-wider">
        {source}
      </Badge>
    );
  };

  const togglePause = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/notifications/capacity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulkPaused: !paused }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Capacity update failed');
      setPaused(value => !value);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Capacity update failed');
    } finally {
      setSaving(false);
    }
  };

  const saveRuntime = async () => {
    setRuntimeSaving(true);
    setRuntimeError(null);
    setRuntimeSuccess(false);
    const parsedLow = Number(low);
    const parsedHigh = Number(high);
    if (!Number.isSafeInteger(parsedLow) || parsedLow < 100 || parsedLow > 1_000_000) {
      setRuntimeError('Low watermark must be 100–1,000,000');
      setRuntimeSaving(false);
      return;
    }
    if (!Number.isSafeInteger(parsedHigh) || parsedHigh < 1_000 || parsedHigh > 1_000_000) {
      setRuntimeError('High watermark must be 1,000–1,000,000');
      setRuntimeSaving(false);
      return;
    }
    if (parsedHigh < parsedLow) {
      setRuntimeError('High watermark must be >= low watermark');
      setRuntimeSaving(false);
      return;
    }
    if (!Number.isInteger(defaultShare) || defaultShare < 5 || defaultShare > 95) {
      setRuntimeError('Default bulk share must be 5–95%');
      setRuntimeSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/notifications/capacity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulkQueueLowWatermark: parsedLow,
          bulkQueueHighWatermark: parsedHigh,
          defaultBulkSharePercent: defaultShare,
          adaptiveBackpressure: adaptive,
          ...(currentRevision != null ? { revision: currentRevision } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; data?: { revision?: number; updatedAt?: string } } & {
        revision?: number;
        updatedAt?: string;
      };
      if (!res.ok) throw new Error((body as { error?: string }).error || 'Runtime update failed');
      const updated = (body as { data?: { revision?: number } }).data ?? body;
      if (updated && typeof updated.revision === 'number') setCurrentRevision(updated.revision);
      setRuntimeSuccess(true);
      window.setTimeout(() => setRuntimeSuccess(false), 2500);
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : 'Runtime update failed');
    } finally {
      setRuntimeSaving(false);
    }
  };

  const effectiveNote = useMemo(() => {
    const dbCount = capacities.filter(c => c.source === 'DATABASE').length;
    const envCount = capacities.filter(c => c.source === 'ENV').length;
    if (dbCount > 0) return `${dbCount} DB-managed · ${envCount} legacy env · workers refresh within ~5s`;
    if (envCount > 0) return `Legacy environment — save in OpsKnight to take ownership`;
    return 'Safe defaults — configure per-provider capacity when ready';
  }, [capacities]);

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription>Bulk delivery</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-primary" />
              Capacity control
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <Badge variant={paused ? 'destructive' : 'secondary'}>{paused ? 'Paused' : 'Running'}</Badge>
            {canManage && (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void togglePause()}>
                {paused ? <PlayCircle className="mr-1.5 h-4 w-4" /> : <PauseCircle className="mr-1.5 h-4 w-4" />}
                {paused ? 'Resume bulk' : 'Pause bulk'}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription>Active worker leases</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ServerCog className="h-5 w-5 text-emerald-500" />
              {workerCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Expiring distributed provider reservations</CardContent>
        </Card>
        <Card className="border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardDescription>Recent campaigns</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Users className="h-5 w-5 text-indigo-500" />
              {campaigns.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Resumable status subscriber fanouts</CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardHeader>
          <CardTitle className="text-sm">Queue & backpressure</CardTitle>
          <CardDescription>
            Watermarks gate new bulk fanout while critical/transactional delivery continues. DB wins over legacy env; no restart required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {queueHealth && (
            <div className={`rounded-lg border p-2.5 text-xs flex items-center justify-between gap-2 ${queueHealth.state === 'PAUSED' ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : queueHealth.depth >= queueHealth.high * 0.8 ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20' : 'border-border/60 bg-muted/20'}`}>
              <div>
                <span className="font-bold">{queueHealth.depth.toLocaleString()}</span>
                <span className="text-muted-foreground"> pending bulk</span>
                <span className="text-muted-foreground"> · {queueHealth.low.toLocaleString()} low / {queueHealth.high.toLocaleString()} high</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant={queueHealth.state === 'PAUSED' ? 'destructive' : queueHealth.hasCapacity ? 'secondary' : 'outline'} className="text-[10px] font-bold uppercase">
                  {queueHealth.state === 'PAUSED' ? 'Backpressure — paused' : queueHealth.hasCapacity ? 'Healthy' : 'Throttled'}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{queueHealth.hasCapacity ? 'allow' : 'pause new bulk'} · {queueHealth.state === 'PAUSED' ? `resumes < ${queueHealth.low.toLocaleString()}` : `pauses ≥ ${queueHealth.high.toLocaleString()}`}</span>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">Low watermark</div>
              <div className="text-lg font-bold">{Number(low).toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground">Queue must drain below this to resume</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">High watermark</div>
              <div className="text-lg font-bold">{Number(high).toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground">Hit high → pause; hysteresis prevents flap</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">Source</div>
              <div className="mt-1 flex gap-1.5 flex-wrap">
                {watermarks ? sourceBadge(watermarks.source) : null}
                <Badge variant="outline" className="text-[10px]">rev {currentRevision ?? runtime?.revision ?? watermarks?.revision ?? '—'}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{runtime ? 'DB-managed' : watermarks?.source === 'ENV' ? 'Legacy env — save to own' : 'Defaults'}</div>
            </div>
          </div>

          {canManage ? (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wm-low" className="text-xs font-semibold">Low watermark</Label>
                  <Input id="wm-low" inputMode="numeric" value={low} onChange={e => setLow(e.target.value)} className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wm-high" className="text-xs font-semibold">High watermark</Label>
                  <Input id="wm-high" inputMode="numeric" value={high} onChange={e => setHigh(e.target.value)} className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wm-share" className="text-xs font-semibold">Default bulk share — {defaultShare}%</Label>
                  <input id="wm-share" type="range" min={5} max={95} value={defaultShare} onChange={e => setDefaultShare(Number(e.target.value))} className="w-full accent-primary" />
                  <div className="flex justify-between text-[10px] text-muted-foreground"><span>5% bulk</span><span>95% bulk</span></div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <Switch checked={adaptive} onCheckedChange={setAdaptive} />
                  <span className="font-semibold">Adaptive backpressure</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void saveRuntime()} disabled={runtimeSaving} className="h-8 text-xs font-semibold">
                    {runtimeSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    {runtimeSaving ? 'Saving…' : 'Save queue settings'}
                  </Button>
                  {runtimeSuccess && <span className="text-xs font-medium text-emerald-600">Saved</span>}
                </div>
              </div>
              {runtimeError && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{runtimeError}</AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Auditor view — runtime is read-only.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-xs">
        <CardHeader>
          <CardTitle className="text-sm">Provider capacity</CardTitle>
          <CardDescription>
            Configured vs effective rate, bulk share, and in-flight. Effective halves on 429/Retry-After and recovers gradually. {effectiveNote}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capacities.map(item => (
            <div key={`${item.channel}:${item.provider ?? 'default'}`} className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">
                  {!item.provider || item.provider === 'default' ? item.channel : `${item.provider} · ${item.channel}`}
                </strong>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {item.mode ? <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider">{item.mode}</Badge> : null}
                  {sourceBadge(item.source)}
                  <Badge variant="outline" className="text-[10px]">{item.adaptiveBackpressure ? 'Adaptive' : 'Fixed'}</Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Configured</span>
                  <div className="font-bold font-mono">{item.configuredRatePerSecond}/s</div>
                  <span className="text-[11px] text-muted-foreground">effective {item.effectiveRatePerSecond}/s</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Bulk max</span>
                  <div className="font-bold font-mono">{item.bulkRatePerSecond}/s</div>
                  <span className="text-[11px] text-muted-foreground">{item.bulkShare != null ? `${Math.round(item.bulkShare * 100)}% bulk` : '80% bulk'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">In flight</span>
                  <div className="font-bold font-mono">{item.maxInFlight}</div>
                  <span className="text-[11px] text-muted-foreground">bulk {item.bulkMaxInFlight ?? '—'}</span>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                Per-provider overrides live on the Providers page (Capacity section in each card). Use CUSTOM only when provider quota demands it.
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {campaigns.length > 0 && (
        <Card className="border-border/80 shadow-xs">
          <CardHeader>
            <CardTitle className="text-sm">Fanout progress</CardTitle>
            <CardDescription>Latest durable subscriber campaigns.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {campaigns.map(campaign => {
              const attempted = campaign.materializedTargets + campaign.failedTargets;
              const percent = attempted === 0 ? 0 : Math.round((campaign.completedTargets / attempted) * 100);
              return (
                <div key={campaign.id} className="rounded-lg border border-border/70 p-3">
                  <div className="flex justify-between text-sm">
                    <span>{campaign.sourceType.replaceAll('_', ' ')}</span>
                    <Badge variant="outline">{campaign.status}</Badge>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {campaign.materializedTargets} queued · {campaign.completedTargets} delivered · {campaign.failedTargets} failed
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
