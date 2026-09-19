'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Trash2,
  RotateCcw,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Database,
  FileText,
  UserX,
  Clock,
} from 'lucide-react';
import { notify } from '@/lib/toast';

interface CleanupPreviewData {
  incidents: number;
  alerts: number;
  logs: number;
  metrics: number;
  events: number;
  auditLogs: number;
  inAppNotifications: number;
  slaPerformanceLogs: number;
  held: {
    incidents: number;
    privacyRequests: number;
  };
  lifecycle: {
    privacyRequests: number;
    expiredExportArtifacts: number;
    unsubscribedSubscribers: number;
  };
  executionTimeMs: number;
  dryRun: boolean;
}

export default function CleanupPreview({
  onCleanupCompleted,
}: {
  onCleanupCompleted?: () => void;
}) {
  const [preview, setPreview] = useState<CleanupPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeInput, setPurgeInput] = useState('');
  const [purging, setPurging] = useState(false);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });

      const data = await res.json();
      if (!res.ok)
        throw new Error(data.message || data.error?.userMessage || 'Failed to preview cleanup');
      setPreview(data.result);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Error fetching cleanup preview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handleActualPurge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purgeInput !== 'PURGE') {
      notify.error('Please type PURGE to confirm destructive cleanup');
      return;
    }

    setPurging(true);
    try {
      const res = await fetch('/api/settings/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });

      const data = await res.json();
      if (!res.ok)
        throw new Error(data.message || data.error?.userMessage || 'Failed to run cleanup');

      notify.success(
        `Cleanup executed successfully: deleted ${data.result.incidents} incidents, ${data.result.alerts} alerts`
      );
      setPurgeModalOpen(false);
      setPurgeInput('');
      fetchPreview();
      onCleanupCompleted?.();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Cleanup execution failed');
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-6 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold text-foreground">Data Cleanup Preview</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Simulate retention enforcement to preview records eligible for deletion versus protected
            by holds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPreview()}
            disabled={loading}
            className="text-xs h-8"
          >
            <RotateCcw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Preview Cleanup
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setPurgeInput('');
              setPurgeModalOpen(true);
            }}
            disabled={loading || !preview}
            className="text-xs h-8"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Run Cleanup
          </Button>
        </div>
      </div>

      {loading && !preview ? (
        <div className="py-12 text-center text-muted-foreground text-xs">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
          Calculating cleanup preview with active retention holds...
        </div>
      ) : preview ? (
        <div className="space-y-4">
          {/* Key Resource Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Incidents */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Resolved Incidents
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {preview.incidents + (preview.held?.incidents || 0)} eligible
                </Badge>
              </div>
              <div className="space-y-1 text-xs pt-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Protected by Holds:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {preview.held?.incidents || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Will Delete:</span>
                  <span className="font-semibold text-rose-500">{preview.incidents}</span>
                </div>
              </div>
            </div>

            {/* Privacy Requests */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-blue-500" />
                  Completed Privacy Requests
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {(preview.lifecycle?.privacyRequests || 0) + (preview.held?.privacyRequests || 0)}{' '}
                  eligible
                </Badge>
              </div>
              <div className="space-y-1 text-xs pt-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Protected by Holds:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {preview.held?.privacyRequests || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Will Delete:</span>
                  <span className="font-semibold text-rose-500">
                    {preview.lifecycle?.privacyRequests || 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Status Page Subscribers */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <UserX className="h-4 w-4 text-purple-500" />
                  Unsubscribed Subscribers
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {preview.lifecycle?.unsubscribedSubscribers || 0} eligible
                </Badge>
              </div>
              <div className="space-y-1 text-xs pt-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Protected by Holds:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Will Purge:</span>
                  <span className="font-semibold text-rose-500">
                    {preview.lifecycle?.unsubscribedSubscribers || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Operational Logs & Metrics Summary */}
          <div className="rounded-lg border border-border/50 bg-card p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Secondary Telemetry &amp; Log Pruning
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 rounded-md bg-muted/30">
                <p className="text-[11px] text-muted-foreground">Alerts</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{preview.alerts}</p>
              </div>
              <div className="p-2.5 rounded-md bg-muted/30">
                <p className="text-[11px] text-muted-foreground">Incident Events</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{preview.events}</p>
              </div>
              <div className="p-2.5 rounded-md bg-muted/30">
                <p className="text-[11px] text-muted-foreground">Audit Logs</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{preview.auditLogs}</p>
              </div>
              <div className="p-2.5 rounded-md bg-muted/30">
                <p className="text-[11px] text-muted-foreground">Metrics Rollups</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{preview.metrics}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Destructive PURGE Modal */}
      {purgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4 animate-in fade-in-50">
          <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-destructive/10 text-destructive shrink-0 mt-0.5">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-semibold text-foreground">
                  Confirm Permanent Cleanup
                </h4>
                <p className="text-xs text-muted-foreground">
                  This operation permanently purges expired records across OpsKnight. Resources
                  protected by active retention holds will NOT be deleted.
                </p>
              </div>
            </div>

            <form onSubmit={handleActualPurge} className="space-y-4 text-xs">
              <div className="space-y-2">
                <Label htmlFor="purgeConfirm">
                  Type <span className="font-mono font-bold text-destructive">PURGE</span> to
                  confirm:
                </Label>
                <Input
                  id="purgeConfirm"
                  placeholder="PURGE"
                  value={purgeInput}
                  onChange={e => setPurgeInput(e.target.value)}
                  className="font-mono text-xs"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPurgeModalOpen(false);
                    setPurgeInput('');
                  }}
                  disabled={purging}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={purging || purgeInput !== 'PURGE'}
                >
                  {purging && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Execute Cleanup
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
