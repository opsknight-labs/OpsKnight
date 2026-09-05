'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import ConfirmDialog from '@/components/settings/ConfirmDialog';
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Clock,
  BarChart3,
  Database,
  FileText,
  Bell,
  Loader2,
  XCircle,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface RetentionPolicy {
  incidentRetentionDays: number;
  alertRetentionDays: number;
  logRetentionDays: number;
  metricsRetentionDays: number;
  realTimeWindowDays: number;
}

interface StorageStats {
  incidents: { total: number; byStatus: Record<string, number>; oldest: string | null };
  alerts: { total: number; oldest: string | null };
  logs: { total: number; oldest: string | null };
  auditLogs?: { total: number; oldest: string | null };
  rollups: { total: number; oldest: string | null };
}

interface Preset {
  name: string;
  incidentRetentionDays: number;
  alertRetentionDays: number;
  logRetentionDays: number;
  metricsRetentionDays: number;
  realTimeWindowDays: number;
}

interface CleanupResult {
  incidents: number;
  alerts: number;
  logs: number;
  metrics: number;
  events: number;
  auditLogs: number;
  executionTimeMs: number;
  dryRun: boolean;
}

const DEFAULT_POLICY: RetentionPolicy = {
  incidentRetentionDays: 730,
  alertRetentionDays: 365,
  logRetentionDays: 365,
  metricsRetentionDays: 365,
  realTimeWindowDays: 90,
};

function displayError(error: unknown, fallback: string): string {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description || friendly.title;
}

export default function RetentionPolicySettings() {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [initialPolicy, setInitialPolicy] = useState<RetentionPolicy | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Field-level validation errors
  const [validationErrors, setValidationErrors] = useState<
    Partial<Record<keyof RetentionPolicy, string>>
  >({});

  // Confirm Dialog State
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingCleanupAction, setPendingCleanupAction] = useState<(() => void) | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/settings/retention');
      if (!res.ok) {
        throw await errorFromResponse(res, 'Failed to fetch settings');
      }
      const data = await res.json();
      setPolicy(data.policy);
      setInitialPolicy(data.policy);
      setStats(data.stats);
      setPresets(data.presets);
    } catch (err) {
      setGeneralError(displayError(err, 'Failed to load retention settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const validatePolicy = (currentPolicy: RetentionPolicy): boolean => {
    const errors: Partial<Record<keyof RetentionPolicy, string>> = {};
    let isValid = true;

    if (currentPolicy.incidentRetentionDays < 30 || currentPolicy.incidentRetentionDays > 3650) {
      errors.incidentRetentionDays = 'Must be between 30 days and 10 years';
      isValid = false;
    }
    if (currentPolicy.alertRetentionDays < 7 || currentPolicy.alertRetentionDays > 3650) {
      errors.alertRetentionDays = 'Must be between 7 days and 10 years';
      isValid = false;
    }
    if (currentPolicy.logRetentionDays < 1 || currentPolicy.logRetentionDays > 3650) {
      errors.logRetentionDays = 'Must be between 1 day and 10 years';
      isValid = false;
    }
    if (currentPolicy.metricsRetentionDays < 30 || currentPolicy.metricsRetentionDays > 3650) {
      errors.metricsRetentionDays = 'Must be between 30 days and 10 years';
      isValid = false;
    }
    if (currentPolicy.realTimeWindowDays < 7 || currentPolicy.realTimeWindowDays > 365) {
      errors.realTimeWindowDays = 'Must be between 7 days and 1 year';
      isValid = false;
    } else if (currentPolicy.realTimeWindowDays > currentPolicy.metricsRetentionDays) {
      errors.realTimeWindowDays = 'Cannot exceed metrics retention period';
      isValid = false;
    }

    setValidationErrors(errors);
    return isValid;
  };

  // Use useMemo for dirty check instead of JSON.stringify on every render
  const isDirty = useMemo(() => {
    if (!policy || !initialPolicy) return false;
    return (
      policy.incidentRetentionDays !== initialPolicy.incidentRetentionDays ||
      policy.alertRetentionDays !== initialPolicy.alertRetentionDays ||
      policy.logRetentionDays !== initialPolicy.logRetentionDays ||
      policy.metricsRetentionDays !== initialPolicy.metricsRetentionDays ||
      policy.realTimeWindowDays !== initialPolicy.realTimeWindowDays
    );
  }, [policy, initialPolicy]);

  const handleSave = async () => {
    if (!policy) return;

    if (!validatePolicy(policy)) {
      setGeneralError('Please fix the validation errors below.');
      return;
    }

    try {
      setSaving(true);
      setGeneralError(null);
      setSuccess(null);

      const res = await fetch('/api/settings/retention', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });

      if (!res.ok) {
        throw await errorFromResponse(res, 'Failed to save');
      }

      setSuccess('Retention policy updated successfully');
      setInitialPolicy(policy);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setGeneralError(displayError(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const executeCleanup = async (dryRun: boolean) => {
    if (!policy) return;

    if (!validatePolicy(policy)) {
      setGeneralError(
        `Please fix validation errors below before running ${dryRun ? 'preview' : 'cleanup'}.`
      );
      return;
    }

    try {
      setSaving(true);
      setGeneralError(null);
      setCleanupResult(null);

      const res = await fetch('/api/settings/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, policy }),
      });

      if (!res.ok) {
        throw await errorFromResponse(res, 'Failed to run cleanup');
      }

      const data = await res.json();
      setCleanupResult(data.result);

      if (!dryRun) {
        setSuccess('Data cleanup completed successfully');
        // Refresh stats after cleanup
        fetchData();
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setGeneralError(displayError(err, 'Failed to run cleanup'));
    } finally {
      setSaving(false);
    }
  };

  const handleCleanupClick = (dryRun: boolean) => {
    if (dryRun) {
      executeCleanup(true);
    } else {
      setPendingCleanupAction(() => () => executeCleanup(false));
      setConfirmOpen(true);
    }
  };

  const handleResetDefaults = () => {
    setPolicy(DEFAULT_POLICY);
    setValidationErrors({});
    setSuccess('Restored defaults (unsaved).');
  };

  const handleResetChanges = () => {
    if (initialPolicy) {
      setPolicy(initialPolicy);
      setValidationErrors({});
    }
  };

  const handleInputChange = (field: keyof RetentionPolicy, value: string) => {
    const num = Number.parseInt(value, 10);
    if (!policy) return;

    // Clear error for this field when user types
    // `field` is a compile-time `keyof RetentionPolicy`, not request input.
    // eslint-disable-next-line security/detect-object-injection
    if (validationErrors[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: undefined }));
      if (Object.keys(validationErrors).length <= 1) setGeneralError(null);
    }

    if (value === '') {
      setPolicy({ ...policy, [field]: '' });
      return;
    }
    if (isNaN(num)) return;
    setPolicy({ ...policy, [field]: num });
  };

  const handlePresetClick = (preset: Preset) => {
    setPolicy({
      incidentRetentionDays: preset.incidentRetentionDays,
      alertRetentionDays: preset.alertRetentionDays,
      logRetentionDays: preset.logRetentionDays,
      metricsRetentionDays: preset.metricsRetentionDays,
      realTimeWindowDays: preset.realTimeWindowDays,
    });
    setValidationErrors({});
    setGeneralError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      {generalError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="bg-emerald-500/10 border-emerald-500/30">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="text-emerald-700 dark:text-emerald-300 font-medium">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* ════════════════════════════════════════════════
          CARD 1: CURRENT STORAGE FOOTPRINT
      ════════════════════════════════════════════════ */}
      {stats && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b">
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Database Storage Footprint</h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Live record counts and oldest recorded data points across historical telemetry
                  tables.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={loading}
              className="h-8 text-xs gap-1.5 shrink-0 self-start sm:self-center"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Stats</span>
            </Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CompactStatRowItem
              icon={<Database className="w-4 h-4 text-blue-500" />}
              label="Incidents"
              value={stats.incidents.total}
              oldest={stats.incidents.oldest}
              subtext="Timelines & postmortems"
            />
            <CompactStatRowItem
              icon={<Bell className="w-4 h-4 text-amber-500" />}
              label="Alerts"
              value={stats.alerts.total}
              oldest={stats.alerts.oldest}
              subtext="Integration payloads"
            />
            <CompactStatRowItem
              icon={<FileText className="w-4 h-4 text-violet-500" />}
              label="Audit Logs"
              value={(stats.auditLogs?.total ?? 0) > 0 ? stats.auditLogs!.total : stats.logs.total}
              oldest={
                (stats.auditLogs?.total ?? 0) > 0 ? stats.auditLogs!.oldest : stats.logs.oldest
              }
              subtext={
                (stats.auditLogs?.total ?? 0) > 0
                  ? 'Administrative changes'
                  : stats.logs.total > 0
                    ? 'System & event logs'
                    : 'Administrative changes'
              }
            />
            <CompactStatRowItem
              icon={<BarChart3 className="w-4 h-4 text-emerald-500" />}
              label="Metric Rollups"
              value={stats.rollups.total}
              oldest={stats.rollups.oldest}
              subtext="Time-series aggregates"
            />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════
          CARD 2: RETENTION SCHEDULE & POLICY RULES
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Retention Schedule & Rules</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Define how long records are kept before becoming eligible for automated lifecycle
                pruning.
              </p>
            </div>
          </div>

          {/* Quick preset selector pills */}
          {presets.length > 0 && (
            <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg border shrink-0 self-start sm:self-center">
              <span className="text-[11px] font-medium text-muted-foreground px-1.5 hidden sm:inline">
                Preset:
              </span>
              {presets.map(preset => {
                const isActive =
                  policy &&
                  policy.incidentRetentionDays === preset.incidentRetentionDays &&
                  policy.alertRetentionDays === preset.alertRetentionDays &&
                  policy.logRetentionDays === preset.logRetentionDays &&
                  policy.metricsRetentionDays === preset.metricsRetentionDays &&
                  policy.realTimeWindowDays === preset.realTimeWindowDays;

                return (
                  <Button
                    key={preset.name}
                    type="button"
                    variant={isActive ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handlePresetClick(preset)}
                    disabled={saving}
                    className="text-xs h-7 px-2.5 font-medium"
                  >
                    {preset.name}
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        {policy && (
          <div className="divide-y divide-border/60">
            <RetentionFieldRow
              icon={<Database className="w-4 h-4 text-blue-500" />}
              label="Incident History & Postmortems"
              description="Resolved incidents, timelines, responder assignments, and post-incident investigation reviews."
              value={policy.incidentRetentionDays}
              onChange={v => handleInputChange('incidentRetentionDays', v)}
              min={30}
              max={3650}
              shortcuts={[90, 180, 365, 730]}
              error={validationErrors.incidentRetentionDays}
            />

            <RetentionFieldRow
              icon={<Bell className="w-4 h-4 text-amber-500" />}
              label="Alert Logs & Raw Webhook Payloads"
              description="Inbound alert events received from Datadog, Prometheus, CloudWatch, and custom monitoring webhooks."
              value={policy.alertRetentionDays}
              onChange={v => handleInputChange('alertRetentionDays', v)}
              min={7}
              max={3650}
              shortcuts={[14, 30, 90, 365]}
              error={validationErrors.alertRetentionDays}
            />

            <RetentionFieldRow
              icon={<FileText className="w-4 h-4 text-violet-500" />}
              label="Audit Trails & Security Events"
              description="Cryptographic security logs, administrative policy changes, authentication traces, and user actions."
              value={policy.logRetentionDays}
              onChange={v => handleInputChange('logRetentionDays', v)}
              min={1}
              max={3650}
              shortcuts={[30, 90, 180, 365]}
              error={validationErrors.logRetentionDays}
            />

            <RetentionFieldRow
              icon={<BarChart3 className="w-4 h-4 text-emerald-500" />}
              label="Historical Metric Rollups"
              description="Aggregated performance time-series rollups stored in hourly and daily rollup buckets."
              value={policy.metricsRetentionDays}
              onChange={v => handleInputChange('metricsRetentionDays', v)}
              min={30}
              max={3650}
              shortcuts={[90, 180, 365, 730]}
              error={validationErrors.metricsRetentionDays}
            />

            <RetentionFieldRow
              icon={<Clock className="w-4 h-4 text-cyan-500" />}
              label="Live High-Resolution Analytics Window"
              description="Period queryable at raw second-by-second resolution before downsampling into aggregate metric rollups."
              value={policy.realTimeWindowDays}
              onChange={v => handleInputChange('realTimeWindowDays', v)}
              min={7}
              max={365}
              shortcuts={[14, 30, 60, 90]}
              error={validationErrors.realTimeWindowDays}
            />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════
          CARD 3: DATA PRUNING & LIFECYCLE CLEANUP
      ════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-rose-500/20 bg-card p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
              <Trash2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-foreground">
                  Data Pruning & Lifecycle Maintenance
                </h3>
                <Badge
                  variant="outline"
                  className="text-[10px] font-semibold text-rose-600 border-rose-500/30 bg-rose-500/5"
                >
                  Permanent Action
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Purge records older than your configured retention thresholds to reclaim database
                storage. Always run a dry run preview first to audit affected row counts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCleanupClick(true)}
              disabled={saving}
              className="h-8 text-xs gap-1.5 font-medium"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
              )}
              <span>Preview (Dry Run)</span>
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => handleCleanupClick(false)}
              disabled={saving}
              className="h-8 text-xs gap-1.5 font-semibold"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Execute Cleanup</span>
            </Button>
          </div>
        </div>

        {/* Cleanup result breakdown */}
        {cleanupResult && (
          <div
            className={`rounded-xl border p-4 space-y-3 ${
              cleanupResult.dryRun
                ? 'bg-blue-500/5 border-blue-500/20'
                : 'bg-emerald-500/5 border-emerald-500/20'
            }`}
          >
            <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
              <div className="flex items-center gap-2">
                {cleanupResult.dryRun ? (
                  <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                )}
                <span className="text-xs font-bold text-foreground">
                  {cleanupResult.dryRun
                    ? 'Simulation Audit Result (Dry Run)'
                    : 'Cleanup Execution Complete'}
                </span>
              </div>
              <Badge variant="secondary" className="text-[10px] font-mono">
                {cleanupResult.executionTimeMs}ms execution
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-1">
              <StatItem label="Incidents" value={cleanupResult.incidents} />
              <StatItem label="Alerts" value={cleanupResult.alerts} />
              <StatItem label="Logs" value={cleanupResult.logs} />
              <StatItem label="Audit Logs" value={cleanupResult.auditLogs} />
              <StatItem label="Events" value={cleanupResult.events} />
              <StatItem label="Metrics" value={cleanupResult.metrics} />
            </div>

            {cleanupResult.dryRun && (
              <p className="text-[11px] text-muted-foreground pt-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>
                  Zero database rows were deleted. These counts reflect records eligible for
                  deletion.
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════
          CARD 4: STICKY SAVE ACTION BAR
      ════════════════════════════════════════════════ */}
      <div className="sticky bottom-4 z-10 rounded-xl border bg-card/95 backdrop-blur-md p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
        <div className="flex items-center gap-2">
          {!isDirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetDefaults}
              className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to System Defaults</span>
            </Button>
          ) : (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              You have unsaved retention schedule changes
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDirty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetChanges}
              className="h-9 text-xs"
            >
              Discard Changes
            </Button>
          )}

          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            size="sm"
            className="h-9 text-xs px-4 font-semibold"
          >
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            <span>Save Retention Policy</span>
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Permanently Delete Data?"
        message="This action will permanently delete all data older than the configured retention periods across database tables. This action cannot be undone."
        confirmLabel="Yes, Delete Data"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          if (pendingCleanupAction) pendingCleanupAction();
          setConfirmOpen(false);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingCleanupAction(null);
        }}
      />
    </div>
  );
}

// Subcomponents

function daysToHuman(days: number | string): string {
  const num = typeof days === 'number' ? days : Number(days);
  if (isNaN(num) || num <= 0) return '';
  if (num >= 730) return `~${(num / 365).toFixed(1).replace(/\.0$/, '')} yrs`;
  if (num >= 365) return '~1 yr';
  if (num >= 60) return `~${Math.round(num / 30)} mos`;
  if (num >= 30) return '~1 mo';
  return `${num} d`;
}

function RetentionFieldRow({
  icon,
  label,
  description,
  value,
  onChange,
  min,
  max,
  shortcuts,
  error,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: number | string;
  onChange: (val: string) => void;
  min?: number;
  max?: number;
  shortcuts?: number[];
  error?: string;
}) {
  const human = daysToHuman(value);
  const currentNum = Number(value);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 border-b border-border/60 last:border-0 hover:bg-muted/15 transition-colors px-1 sm:px-2 rounded-lg">
      <div className="space-y-1 flex-1 min-w-0 pr-2 sm:pr-4">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0">{icon}</div>
          <Label className="text-sm font-semibold text-foreground leading-none">{label}</Label>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed pl-6">{description}</p>
        {error && (
          <p className="text-xs text-destructive mt-1 flex items-center gap-1 font-medium pl-6">
            <XCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col sm:items-end gap-1.5 shrink-0 self-start sm:self-center pl-6 sm:pl-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center">
            <Input
              type="number"
              min={min}
              max={max}
              value={value}
              onChange={e => onChange(e.target.value)}
              className={`w-20 rounded-r-none border-r-0 font-mono text-xs h-8 ${
                error ? 'border-destructive focus-visible:ring-destructive' : ''
              }`}
            />
            <div
              className={`inline-flex items-center px-2.5 h-8 rounded-r-md border bg-muted text-muted-foreground text-xs font-medium ${
                error ? 'border-destructive bg-destructive/10' : ''
              }`}
            >
              days
            </div>
          </div>
          {human && (
            <span className="text-[11px] font-mono font-medium text-foreground bg-muted/80 px-2 py-1 rounded-md border border-border/50 min-w-[55px] text-center">
              {human}
            </span>
          )}
        </div>

        {/* Quick shortcut duration chips */}
        {shortcuts && shortcuts.length > 0 && (
          <div className="flex items-center gap-1 pt-0.5">
            <span className="text-[10px] text-muted-foreground">Quick:</span>
            {shortcuts.map(days => {
              const isSelected = currentNum === days;
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => onChange(String(days))}
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary font-bold shadow-xs'
                      : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/80'
                  }`}
                >
                  {daysToHuman(days)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CompactStatRowItem({
  icon,
  label,
  value,
  oldest,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  oldest: string | null;
  subtext?: string;
}) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'None recorded';
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col justify-between gap-2.5 shadow-sm transition-all hover:border-border">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="p-1.5 rounded-lg bg-muted text-muted-foreground shrink-0">{icon}</div>
      </div>
      <div>
        <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
          {value.toLocaleString()}
        </div>
        {subtext && <p className="text-[11px] text-muted-foreground truncate">{subtext}</p>}
        <div className="text-[11px] text-muted-foreground mt-1.5 pt-1.5 border-t border-border/40 flex items-center gap-1">
          <Clock className="w-3 h-3 text-muted-foreground/70 shrink-0" />
          <span className="truncate">Oldest: {formatDate(oldest)}</span>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col p-2 rounded-lg bg-background border border-border/60">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 truncate">
        {label}
      </span>
      <span className="font-mono font-bold text-foreground text-sm">{value.toLocaleString()}</span>
    </div>
  );
}
