'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gauge, Info, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';

type Mode = 'AUTO' | 'CUSTOM';

type SnapshotRow = {
  provider: string;
  channel: string;
  mode: Mode;
  ratePerSecond: number | null;
  maxInFlight: number | null;
  bulkSharePercent: number;
  adaptiveBackpressure: boolean;
  revision: number;
  updatedAt: string;
};

type CapacitySnapshot = {
  bulkPaused: boolean;
  providerCapacities: SnapshotRow[];
  hardLimits: {
    ratePerSecond: { min: number; max: number };
    maxInFlight: { min: number; max: number };
    bulkSharePercent: { min: number; max: number };
  };
};

function channelForProviderKey(providerKey: string): string {
  switch (providerKey) {
    case 'twilio':
      return 'SMS';
    case 'whatsapp':
      return 'WHATSAPP';
    case 'web-push':
      return 'PUSH';
    case 'slack':
      return 'SLACK';
    case 'webhook':
      return 'WEBHOOK';
    default:
      return 'EMAIL';
  }
}

function providerForCapacityKey(providerKey: string): string {
  // whatsapp UI shares the twilio persistence row but capacity rows are
  // split by channel so Twilio SMS and WhatsApp can differ.
  if (providerKey === 'whatsapp') return 'twilio';
  return providerKey.toLowerCase();
}

export default function ProviderCapacitySettings({
  providerKey,
  compact,
}: {
  providerKey: string;
  compact?: boolean;
}) {
  const channel = channelForProviderKey(providerKey);
  const provider = providerForCapacityKey(providerKey);

  const [snapshot, setSnapshot] = useState<CapacitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const row = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.providerCapacities.find(r => r.provider === provider && r.channel === channel) ?? null;
  }, [snapshot, provider, channel]);

  const [mode, setMode] = useState<Mode>('AUTO');
  const [ratePerSecond, setRatePerSecond] = useState<string>('');
  const [maxInFlight, setMaxInFlight] = useState<string>('');
  const [bulkSharePercent, setBulkSharePercent] = useState<number>(80);
  const [adaptiveBackpressure, setAdaptiveBackpressure] = useState<boolean>(true);
  const [revision, setRevision] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/admin/notifications/capacity', { cache: 'no-store' });
        const body = (await res.json()) as { data?: CapacitySnapshot; error?: string } & CapacitySnapshot;
        if (!res.ok) throw new Error((body as { error?: string }).error || 'Unable to load capacity');
        const data: CapacitySnapshot = (body as { data?: CapacitySnapshot }).data ?? (body as CapacitySnapshot);
        if (cancelled) return;
        setSnapshot(data);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Unable to load capacity');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const current = snapshot.providerCapacities.find(r => r.provider === provider && r.channel === channel);
    if (current) {
      setMode(current.mode);
      setRatePerSecond(current.ratePerSecond != null ? String(current.ratePerSecond) : '');
      setMaxInFlight(current.maxInFlight != null ? String(current.maxInFlight) : '');
      setBulkSharePercent(current.bulkSharePercent);
      setAdaptiveBackpressure(current.adaptiveBackpressure);
      setRevision(current.revision);
    } else {
      setMode('AUTO');
      setRatePerSecond('');
      setMaxInFlight('');
      setBulkSharePercent(80);
      setAdaptiveBackpressure(true);
      setRevision(null);
    }
  }, [snapshot, provider, channel]);

  const limits = snapshot?.hardLimits;

  const buildPayload = (): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      provider,
      channel,
      mode,
      bulkSharePercent,
      adaptiveBackpressure,
    };
    if (revision != null) base.revision = revision;
    if (mode === 'CUSTOM') {
      base.ratePerSecond = ratePerSecond.trim() === '' ? null : Number(ratePerSecond);
      base.maxInFlight = maxInFlight.trim() === '' ? null : Number(maxInFlight);
    } else {
      base.ratePerSecond = null;
      base.maxInFlight = null;
    }
    return base;
  };

  const isDirty = useMemo(() => {
    if (!snapshot) return false;
    if (!row) {
      // Not yet persisted — dirty if non-default
      if (mode !== 'AUTO') return true;
      if (bulkSharePercent !== 80) return true;
      if (!adaptiveBackpressure) return true;
      return false;
    }
    if (mode !== row.mode) return true;
    if (bulkSharePercent !== row.bulkSharePercent) return true;
    if (adaptiveBackpressure !== row.adaptiveBackpressure) return true;
    if (mode === 'CUSTOM') {
      const nextRate = ratePerSecond.trim() === '' ? null : Number(ratePerSecond);
      const nextInflight = maxInFlight.trim() === '' ? null : Number(maxInFlight);
      if (nextRate !== row.ratePerSecond) return true;
      if (nextInflight !== row.maxInFlight) return true;
    }
    return false;
  }, [snapshot, row, mode, bulkSharePercent, adaptiveBackpressure, ratePerSecond, maxInFlight]);

  const validate = (): string | null => {
    const bulkMin = limits?.bulkSharePercent.min ?? 5;
    const bulkMax = limits?.bulkSharePercent.max ?? 95;
    if (!Number.isInteger(bulkSharePercent) || bulkSharePercent < bulkMin || bulkSharePercent > bulkMax) {
      return `Bulk share must be ${bulkMin}–${bulkMax}%`;
    }
    if (mode === 'CUSTOM') {
      const rateMin = limits?.ratePerSecond.min ?? 1;
      const rateMax = limits?.ratePerSecond.max ?? 10_000;
      const inflightMin = limits?.maxInFlight.min ?? 1;
      const inflightMax = limits?.maxInFlight.max ?? 5_000;
      const parsedRate = ratePerSecond.trim() === '' ? NaN : Number(ratePerSecond);
      const parsedInflight = maxInFlight.trim() === '' ? NaN : Number(maxInFlight);
      if (!Number.isSafeInteger(parsedRate) || parsedRate < rateMin || parsedRate > rateMax) {
        return `Rate must be ${rateMin}–${rateMax} / sec`;
      }
      if (!Number.isSafeInteger(parsedInflight) || parsedInflight < inflightMin || parsedInflight > inflightMax) {
        return `Max in-flight must be ${inflightMin}–${inflightMax}`;
      }
    }
    return null;
  };

  const needsConfirmation = (): boolean => {
    if (mode !== 'CUSTOM' || !row?.ratePerSecond) return false;
    const nextRate = ratePerSecond.trim() === '' ? null : Number(ratePerSecond);
    if (nextRate == null || !Number.isFinite(nextRate)) return false;
    const oldRate = row.ratePerSecond;
    // Unusually large increase — confirm like the spec (e.g. 100 → 5000)
    if (nextRate > 500 && nextRate >= oldRate * 3) return true;
    if (nextRate >= 2000 && nextRate > oldRate * 2) return true;
    return false;
  };

  const executeSave = async (payload: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/admin/notifications/capacity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; data?: SnapshotRow } & SnapshotRow;
      if (!res.ok) {
        const msg = (body as { error?: string }).error || 'Capacity update failed';
        // 409 -> stale revision
        throw new Error(msg);
      }
      const updated: SnapshotRow = (body as { data?: SnapshotRow }).data ?? (body as SnapshotRow);
      setRevision(updated.revision);
      setSaveSuccess(true);
      // Refresh snapshot so effective values and revision converge without reload.
      const refresh = await fetch('/api/admin/notifications/capacity', { cache: 'no-store' });
      const refreshed = (await refresh.json()) as { data?: CapacitySnapshot } & CapacitySnapshot;
      const nextSnapshot: CapacitySnapshot = (refreshed as { data?: CapacitySnapshot }).data ?? (refreshed as CapacitySnapshot);
      if (refresh.ok) setSnapshot(nextSnapshot);
      window.setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Capacity update failed');
    } finally {
      setSaving(false);
      setConfirmOpen(false);
      setPendingPayload(null);
    }
  };

  const onSave = async () => {
    const validationError = validate();
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    const payload = buildPayload();
    if (needsConfirmation()) {
      setPendingPayload(payload);
      setConfirmOpen(true);
      return;
    }
    await executeSave(payload);
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading capacity...
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive" className="py-2">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs">{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={`rounded-xl border border-border/60 bg-muted/20 ${compact ? 'p-3' : 'p-4'} space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold tracking-tight">Delivery Capacity</span>
          <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider">
            {channel} · {provider}
          </Badge>
        </div>
        {row && (
          <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider">
            rev {row.revision}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('AUTO')}
          className={`rounded-lg border p-3 text-left transition-colors ${mode === 'AUTO' ? 'bg-primary/10 border-primary/30 ring-1 ring-primary/20' : 'bg-background border-border/60 hover:bg-muted/40'}`}
        >
          <div className="text-xs font-bold">Automatic — Recommended</div>
          <div className="text-[11px] text-muted-foreground leading-snug mt-1">
            OpsKnight uses safe defaults and automatically throttles when provider pressure is detected.
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode('CUSTOM')}
          className={`rounded-lg border p-3 text-left transition-colors ${mode === 'CUSTOM' ? 'bg-primary/10 border-primary/30 ring-1 ring-primary/20' : 'bg-background border-border/60 hover:bg-muted/40'}`}
        >
          <div className="text-xs font-bold">Custom</div>
          <div className="text-[11px] text-muted-foreground leading-snug mt-1">
            Set explicit rate and concurrency. Bulk share reserves critical capacity.
          </div>
        </button>
      </div>

      {mode === 'CUSTOM' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`rate-${provider}-${channel}`} className="text-xs font-semibold">
              Rate / sec
            </Label>
            <Input
              id={`rate-${provider}-${channel}`}
              inputMode="numeric"
              value={ratePerSecond}
              onChange={e => setRatePerSecond(e.target.value)}
              placeholder={limits ? `${limits.ratePerSecond.min}–${limits.ratePerSecond.max}` : 'e.g. 1000'}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`inflight-${provider}-${channel}`} className="text-xs font-semibold">
              Max in-flight
            </Label>
            <Input
              id={`inflight-${provider}-${channel}`}
              inputMode="numeric"
              value={maxInFlight}
              onChange={e => setMaxInFlight(e.target.value)}
              placeholder={limits ? `${limits.maxInFlight.min}–${limits.maxInFlight.max}` : 'e.g. 300'}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
      )}

      {mode === 'AUTO' && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
          <span>When pressure (429 / Retry-After / latency) is detected, effective rate halves and recovers gradually. No restart required.</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`bulkshare-${provider}-${channel}`} className="text-xs font-semibold">
            Bulk allocation — {bulkSharePercent}% (reserve {100 - bulkSharePercent}% for critical)
          </Label>
          <input
            id={`bulkshare-${provider}-${channel}`}
            type="range"
            min={limits?.bulkSharePercent.min ?? 5}
            max={limits?.bulkSharePercent.max ?? 95}
            value={bulkSharePercent}
            onChange={e => setBulkSharePercent(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>5% bulk</span>
            <span>95% bulk</span>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2">
          <div>
            <div className="text-xs font-semibold">Adaptive throttling</div>
            <div className="text-[11px] text-muted-foreground">Halve on 429, recover slowly</div>
          </div>
          <Switch checked={adaptiveBackpressure} onCheckedChange={setAdaptiveBackpressure} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => void onSave()} disabled={saving || !isDirty} className="h-8 text-xs font-semibold">
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save capacity'}
        </Button>
        {saveSuccess && <span className="text-xs font-medium text-emerald-600">Saved — workers adapt within ~5s</span>}
        {!isDirty && !saveSuccess && <span className="text-xs text-muted-foreground">No changes</span>}
      </div>

      {saveError && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">{saveError} {saveError.includes('changed elsewhere') ? '— reload and retry.' : ''}</AlertDescription>
        </Alert>
      )}

      {confirmOpen && pendingPayload && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-amber-900 dark:text-amber-200">Confirm large capacity increase</div>
              <div className="text-xs text-amber-900/80 dark:text-amber-200/80">
                You are increasing {provider} {channel} from {row?.ratePerSecond ?? '—'}/sec to {String((pendingPayload as Record<string, unknown>).ratePerSecond)}/sec. Ensure your provider account permits this rate.
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => { setConfirmOpen(false); setPendingPayload(null); }} className="h-8 text-xs" disabled={saving}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => void executeSave(pendingPayload)} className="h-8 text-xs" disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Confirm
            </Button>
          </div>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground">
        Hard ceilings ({limits?.ratePerSecond.max ?? 10000}/sec, {limits?.maxInFlight.max ?? 5000} in-flight) always apply. DB wins over legacy env; fresh replicas refresh within ~5s via TTL.
      </div>
    </div>
  );
}
