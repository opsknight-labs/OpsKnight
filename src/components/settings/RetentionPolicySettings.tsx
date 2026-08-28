'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
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
  executionTimeMs: number;
  dryRun: boolean;
}

const DEFAULT_POLICY: RetentionPolicy = {
  incidentRetentionDays: 730,
  alertRetentionDays: 365,
  logRetentionDays: 90,
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

    if (currentPolicy.incidentRetentionDays < 30) {
      errors.incidentRetentionDays = 'Must be at least 30 days';
      isValid = false;
    }
    if (currentPolicy.alertRetentionDays < 7) {
      errors.alertRetentionDays = 'Must be at least 7 days';
      isValid = false;
    }
    if (currentPolicy.logRetentionDays < 1) {
      errors.logRetentionDays = 'Must be at least 1 day';
      isValid = false;
    }
    if (currentPolicy.metricsRetentionDays < 30) {
      errors.metricsRetentionDays = 'Must be at least 30 days';
      isValid = false;
    }
    if (currentPolicy.realTimeWindowDays < 1) {
      errors.realTimeWindowDays = 'Must be at least 1 day';
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
    try {
      setSaving(true);
      setGeneralError(null);
      setCleanupResult(null);

      const res = await fetch('/api/settings/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
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
    const num = parseInt(value);
    if (!policy) return;

    // Clear error for this field when user types
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
    <div className="space-y-6">
      {generalError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700">{success}</AlertDescription>
        </Alert>
      )}

      {/* Horizontal Stats Bar */}
      {stats && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-0 divide-y md:divide-y-0 md:divide-x">
              <CompactStatRowItem
                icon={<Database className="w-4 h-4 text-blue-600" />}
                label="Incidents"
                value={stats.incidents.total}
                oldest={stats.incidents.oldest}
              />
              <CompactStatRowItem
                icon={<Bell className="w-4 h-4 text-orange-600" />}
                label="Alerts"
                value={stats.alerts.total}
                oldest={stats.alerts.oldest}
              />
              <CompactStatRowItem
                icon={<FileText className="w-4 h-4 text-muted-foreground" />}
                label="Logs"
                value={stats.logs.total}
                oldest={stats.logs.oldest}
              />
              <CompactStatRowItem
                icon={<BarChart3 className="w-4 h-4 text-purple-600" />}
                label="Metrics"
                value={stats.rollups.total}
                oldest={stats.rollups.oldest}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Retention Rules</CardTitle>
            {/* Presets */}
            <div className="flex bg-muted p-1 rounded-md gap-1">
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
                    className="text-xs"
                  >
                    {preset.name}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <div className="space-y-6">
            {policy && (
              <>
                <RetentionFieldRow
                  label="Incident History"
                  description="Resolved incidents and postmortems."
                  value={policy.incidentRetentionDays}
                  onChange={v => handleInputChange('incidentRetentionDays', v)}
                  min={30}
                  error={validationErrors.incidentRetentionDays}
                />

                <RetentionFieldRow
                  label="Alert Logs"
                  description="Raw alerts from integrations."
                  value={policy.alertRetentionDays}
                  onChange={v => handleInputChange('alertRetentionDays', v)}
                  min={7}
                  error={validationErrors.alertRetentionDays}
                />

                <RetentionFieldRow
                  label="System Logs"
                  description="Audit trails and debug events."
                  value={policy.logRetentionDays}
                  onChange={v => handleInputChange('logRetentionDays', v)}
                  min={1}
                  error={validationErrors.logRetentionDays}
                />

                <RetentionFieldRow
                  label="Metric Rollups"
                  description="Aggregated performance data (hourly/daily)."
                  value={policy.metricsRetentionDays}
                  onChange={v => handleInputChange('metricsRetentionDays', v)}
                  min={30}
                  error={validationErrors.metricsRetentionDays}
                />

                <RetentionFieldRow
                  label="High-Precision Metrics"
                  description="Raw, real-time metric data points."
                  value={policy.realTimeWindowDays}
                  onChange={v => handleInputChange('realTimeWindowDays', v)}
                  min={1}
                  error={validationErrors.realTimeWindowDays}
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="bg-muted p-2 rounded-full">
              <Trash2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">Data Cleanup</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground max-w-xl">
              Run the cleanup job to permanently delete data older than your configured retention
              policy. We recommend running a <strong>Preview</strong> first.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCleanupClick(true)}
                disabled={saving}
              >
                Preview
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleCleanupClick(false)}
                disabled={saving}
              >
                Execute
              </Button>
            </div>
          </div>

          {cleanupResult && (
            <Alert
              className={`mt-6 ${cleanupResult.dryRun ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'}`}
            >
              <AlertDescription>
                <div className="flex items-center justify-between mb-3 border-b border-border/50 pb-2">
                  <h5
                    className={`text-sm font-semibold flex items-center gap-2 ${cleanupResult.dryRun ? 'text-blue-800' : 'text-green-800'}`}
                  >
                    {cleanupResult.dryRun ? 'Simulation Result' : 'Cleanup Complete'}
                    <Badge variant="secondary" size="xs">
                      {cleanupResult.executionTimeMs}ms
                    </Badge>
                  </h5>
                </div>
                <div className="flex gap-8 text-sm">
                  <StatItem label="Incidents" value={cleanupResult.incidents} />
                  <StatItem label="Alerts" value={cleanupResult.alerts} />
                  <StatItem label="Logs" value={cleanupResult.logs} />
                  <StatItem label="Metrics" value={cleanupResult.metrics} />
                </div>
                {cleanupResult.dryRun && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-blue-600">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>No data was permanently deleted.</span>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        {!isDirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetDefaults}
            className="mr-auto"
          >
            <RotateCcw className="w-3 h-3 mr-2" />
            Reset to Defaults
          </Button>
        )}

        {isDirty && (
          <>
            <div className="mr-auto flex items-center gap-2">
              <Badge variant="warning" size="sm">
                Unsaved changes
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleResetChanges}>
              Discard
            </Button>
          </>
        )}

        <Button onClick={handleSave} disabled={saving || !isDirty} size="sm">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Changes
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Permanently Delete Data?"
        message="This action will permanently delete all data older than the configured retention periods. This action cannot be undone."
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

function RetentionFieldRow({
  label,
  description,
  value,
  onChange,
  min,
  error,
}: {
  label: string;
  description: string;
  value: number | string;
  onChange: (val: string) => void;
  min?: number;
  error?: string;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-6 border-b last:border-0 last:pb-0">
      <div className="flex-1">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
        {error && (
          <p className="text-sm text-destructive mt-1 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-0">
        <Input
          type="number"
          min={min}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`w-24 rounded-r-none border-r-0 ${error ? 'border-destructive focus-visible:ring-destructive' : ''}`}
        />
        <div
          className={`inline-flex items-center px-3 h-10 rounded-r-md border bg-muted text-muted-foreground text-xs font-medium ${error ? 'border-destructive bg-destructive/10' : ''}`}
        >
          days
        </div>
      </div>
    </div>
  );
}

function CompactStatRowItem({
  icon,
  label,
  value,
  oldest,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  oldest: string | null;
}) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="flex-1 px-4 py-2 md:py-0 flex items-center justify-between md:block">
      <div className="flex items-center gap-2 mb-0 md:mb-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-right md:text-left">
        <div className="text-lg font-semibold text-foreground leading-none">
          {value.toLocaleString()}
        </div>
        {oldest && (
          <div className="text-[10px] text-muted-foreground mt-1 flex items-center justify-end md:justify-start gap-1">
            <Clock className="w-3 h-3" />
            Oldest: {formatDate(oldest)}
          </div>
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">{label}</span>
      <span className="font-mono font-medium text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}
