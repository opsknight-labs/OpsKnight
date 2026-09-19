'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Key,
  ShieldCheck,
  RefreshCw,
  Play,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Clock,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { KeyRetirementReport } from '@/lib/encryption/types';

interface KeyringMetadata {
  activeKeyId: string | null;
  keys: Array<{ id: string; source: string; isActive: boolean }>;
  totalKeys: number;
  hasLegacyDbKey: boolean;
}

interface RunTargetState {
  id: string;
  targetId: string;
  status: string;
  totalCount: number;
  processedCount: number;
  migratedCount: number;
  errorCount: number;
  conflictCount: number;
  keysDetected: Record<string, number> | null;
  inspectionStats?: {
    currentV3?: number;
    oldKeyV3?: number;
    legacyV2?: number;
    legacyV1?: number;
    plaintext?: number;
    unavailableKey?: number;
    ambiguous?: number;
    unreadable?: number;
    empty?: number;
  } | null;
}

interface EncryptionRun {
  id: string;
  mode: 'PREVIEW' | 'MIGRATE' | 'VERIFY';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  registryFingerprint: string;
  activeKeyId: string | null;
  totalRecords: number;
  processedRecords: number;
  migratedRecords: number;
  errorRecords: number;
  skippedRecords: number;
  conflictRecords: number;
  safeForDatabaseKeyRetirement: string[] | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  isOrphaned?: boolean;
  orphanReason?: string | null;
  targetStates?: RunTargetState[];
  initiatedBy?: { id: string; name: string | null; email: string } | null;
}

export interface EncryptionMigrationPanelProps {
  readonly canManageEncryption?: boolean;
}

export function EncryptionMigrationPanel({
  canManageEncryption = true,
}: EncryptionMigrationPanelProps) {
  const [loading, setLoading] = useState(true);
  const [keyring, setKeyring] = useState<KeyringMetadata | null>(null);
  const [activeRun, setActiveRun] = useState<EncryptionRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<EncryptionRun[]>([]);
  const [retirementReport, setRetirementReport] = useState<KeyRetirementReport | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRun, setSelectedRun] = useState<EncryptionRun | null>(null);
  const [confirmMigrateModal, setConfirmMigrateModal] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/compliance/encryption/status');
      if (res.ok) {
        const data = await res.json();
        setKeyring(data.keyring);
        setActiveRun(data.activeRun);
      }
    } catch (err) {
      console.error('Failed to load encryption status', err);
    }
  }, []);

  const fetchRetirementReadiness = useCallback(async () => {
    try {
      const res = await fetch('/api/compliance/encryption/retirement-readiness');
      if (res.ok) {
        const data = await res.json();
        setRetirementReport(data.report);
      }
    } catch (err) {
      console.error('Failed to load retirement readiness', err);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/compliance/encryption/runs?limit=10');
      if (res.ok) {
        const data = await res.json();
        setRecentRuns(data.runs);
      }
    } catch (err) {
      console.error('Failed to load encryption runs', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchRetirementReadiness(), fetchRuns()]);
    setLoading(false);
  }, [fetchStatus, fetchRetirementReadiness, fetchRuns]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Polling when active run is running
  useEffect(() => {
    if (!activeRun || (activeRun.status !== 'RUNNING' && activeRun.status !== 'PENDING')) {
      return;
    }

    const interval = setInterval(async () => {
      await fetchStatus();
      await fetchRuns();
      await fetchRetirementReadiness();
    }, 2500);

    return () => clearInterval(interval);
  }, [activeRun, fetchStatus, fetchRuns, fetchRetirementReadiness]);

  const handleStartRun = async (mode: 'PREVIEW' | 'MIGRATE' | 'VERIFY') => {
    setActionError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/compliance/encryption/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || `Failed to start ${mode} run`);
      }

      setConfirmMigrateModal(false);
      await refreshAll();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRun = async (runId: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/compliance/encryption/runs/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to cancel run');
      }

      await refreshAll();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const viewRunDetails = async (runId: string) => {
    try {
      const res = await fetch(`/api/compliance/encryption/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedRun(data.run);
      }
    } catch (err) {
      console.error('Failed to load run details', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Scope Disclaimer Alert */}
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Key className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              Database Encryption Migration &amp; Key-Retirement Readiness
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              OpsKnight migrates secrets to authenticated AES-256-GCM (v3 envelope) using atomic
              Compare-And-Swap (CAS) and verifies database readiness before operators retire legacy
              keys.
              <strong>
                {' '}
                OpsKnight does not manage external KMS, edit secrets files, or delete master keys.
              </strong>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={loading}
            className="gap-1.5 h-8 text-xs"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Top 2-Column: Keyring Overview & Key Retirement Readiness */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Keyring Overview */}
        <div className="rounded-xl border border-border/70 bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">Active Encryption Keyring</h4>
            </div>
            <Badge variant="outline" className="text-xs">
              {keyring?.totalKeys || 0} configured keys
            </Badge>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-border/40">
              <span className="text-muted-foreground">Active Primary Key ID</span>
              <span className="font-mono font-semibold text-foreground">
                {keyring?.activeKeyId ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {keyring.activeKeyId} (Active Writes)
                  </span>
                ) : (
                  <span className="text-destructive">None Configured</span>
                )}
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <span className="text-muted-foreground block">Keyring Inventory:</span>
              <div className="flex flex-wrap gap-2">
                {keyring?.keys.map(k => (
                  <Badge
                    key={k.id}
                    variant={k.isActive ? 'default' : 'secondary'}
                    className={cn(
                      'text-xs font-mono py-1 px-2.5',
                      k.isActive && 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    )}
                  >
                    {k.id} {k.isActive ? '★ active' : '• fallback reader'}
                  </Badge>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground pt-2">
              Ciphertext is written with AES-256-GCM v3 envelope. Legacy v1/v2 AES-CBC ciphertext
              remains decryptable during overlapping key migrations.
            </p>
          </div>
        </div>

        {/* Card 2: Key Retirement Readiness Assessment */}
        <div className="rounded-xl border border-border/70 bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">Key-Retirement Readiness</h4>
            </div>
            {retirementReport?.verifiedRunId ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs">
                Verified Scan Active
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-xs">
                Verification Required
              </Badge>
            )}
          </div>

          <div className="space-y-2 text-xs">
            {retirementReport?.assessments && retirementReport.assessments.length > 0 ? (
              retirementReport.assessments.map(a => (
                <div
                  key={a.keyId}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-foreground">Key: {a.keyId}</span>
                    {a.status === 'DATABASE_READY_FOR_RETIREMENT' && (
                      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Ready for Operator Retirement
                      </Badge>
                    )}
                    {a.status === 'ACTIVE_REFERENCES_EXIST' && (
                      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3 mr-1" /> {a.remainingReferences} secrets
                        remain
                      </Badge>
                    )}
                    {a.status === 'ACTIVE_KEY' && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Active Key
                      </Badge>
                    )}
                    {a.status === 'UNVERIFIED' && (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Unverified
                      </Badge>
                    )}
                    {a.status === 'UNRESOLVED_RECORDS_EXIST' && (
                      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Blocked — unresolved records
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{a.message}</p>
                  <p className="text-[11px] text-foreground font-medium pt-0.5">{a.guidance}</p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-xs py-2">
                No retirement assessments available. Run an Encryption Verification scan to assess
                readiness.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Active Run Banner (if running or queued) */}
      {activeRun && (activeRun.status === 'RUNNING' || activeRun.status === 'PENDING') && (
        <div
          className={cn(
            'rounded-xl border p-4 shadow-xs space-y-3',
            activeRun.isOrphaned
              ? 'border-amber-500/50 bg-amber-500/5 dark:bg-amber-500/10'
              : 'border-primary/40 bg-primary/5'
          )}
        >
          {activeRun.isOrphaned && (
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-semibold pb-1 border-b border-amber-500/20">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {activeRun.orphanReason ||
                  'Run appears orphaned: no active background job found after lease threshold.'}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {activeRun.status === 'PENDING' ? (
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse" />
              ) : (
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              )}
              <span className="text-sm font-semibold text-foreground">
                {activeRun.mode} Run:{' '}
                {activeRun.status === 'PENDING' ? 'Queued (Waiting for worker...)' : 'In Progress'}{' '}
                ({activeRun.id})
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleCancelRun(activeRun.id)}
              className="gap-1.5 h-7 text-xs"
            >
              <StopCircle className="h-3.5 w-3.5" />
              {activeRun.isOrphaned ? 'Recover / Cancel Run' : 'Cancel Run'}
            </Button>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Progress</span>
              <span>
                {activeRun.processedRecords} / {activeRun.totalRecords || '?'} records
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${
                    activeRun.totalRecords > 0
                      ? Math.min(
                          100,
                          Math.round((activeRun.processedRecords / activeRun.totalRecords) * 100)
                        )
                      : activeRun.status === 'PENDING'
                        ? 10
                        : 50
                  }%`,
                }}
              />
            </div>
            <div className="flex gap-4 pt-1 text-[11px] text-muted-foreground">
              <span>
                Migrated: <strong className="text-foreground">{activeRun.migratedRecords}</strong>
              </span>
              <span>
                Conflicts: <strong className="text-foreground">{activeRun.conflictRecords}</strong>
              </span>
              <span>
                Errors: <strong className="text-foreground">{activeRun.errorRecords}</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Control Actions Bar */}
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Controlled Migration Operations
          </h4>
          <p className="text-xs text-muted-foreground">
            Execute preview inspection, CAS database migration, or fresh verification.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleStartRun('PREVIEW')}
            disabled={
              isSubmitting || activeRun?.status === 'RUNNING' || activeRun?.status === 'PENDING'
            }
            className="gap-1.5 h-8 text-xs font-medium"
          >
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            Preview Impact
            <span className="text-[10px] text-muted-foreground font-mono ml-0.5">(Read-Only)</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleStartRun('VERIFY')}
            disabled={
              isSubmitting || activeRun?.status === 'RUNNING' || activeRun?.status === 'PENDING'
            }
            className="gap-1.5 h-8 text-xs font-medium"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Verify Integrity
            <span className="text-[10px] text-muted-foreground font-mono ml-0.5">(Read-Only)</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => setConfirmMigrateModal(true)}
            disabled={
              isSubmitting || activeRun?.status === 'RUNNING' || activeRun?.status === 'PENDING'
            }
            className="gap-1.5 h-8 text-xs font-medium bg-primary hover:bg-primary/90"
          >
            <Play className="h-3.5 w-3.5" />
            Start Migration (CAS)
          </Button>
        </div>
      </div>

      {/* Confirmation Modal for MIGRATE */}
      {confirmMigrateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-lg max-w-md w-full space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-foreground">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Confirm Encryption Migration</h3>
                <p className="text-xs text-muted-foreground">Atomic re-encryption to active key</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              This will re-encrypt all eligible legacy (v1/v2) and old-key (v3) secrets across
              registered database fields to the active key{' '}
              <strong className="text-foreground">({keyring?.activeKeyId})</strong> using
              Compare-And-Swap (CAS) protection against concurrent credential updates.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmMigrateModal(false)}
                disabled={isSubmitting}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => handleStartRun('MIGRATE')}
                disabled={isSubmitting}
                className="h-8 text-xs bg-primary hover:bg-primary/90"
              >
                {isSubmitting ? 'Starting...' : 'Confirm & Start Migration'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Recent Runs History */}
      <div className="rounded-xl border border-border/70 bg-card shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Encryption Migration Runs</h4>
          </div>
          <span className="text-xs text-muted-foreground">Latest 10 executions</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border/40">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Run ID</th>
                <th className="py-2.5 px-4 font-semibold">Mode</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold">Processed</th>
                <th className="py-2.5 px-4 font-semibold">Migrated</th>
                <th className="py-2.5 px-4 font-semibold">Conflicts</th>
                <th className="py-2.5 px-4 font-semibold">Errors</th>
                <th className="py-2.5 px-4 font-semibold">Created At</th>
                <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {recentRuns.length > 0 ? (
                recentRuns.map(run => (
                  <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-foreground">
                      {run.id.slice(0, 10)}...
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className="font-semibold text-[10px]">
                        {run.mode}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        className={cn(
                          'text-[10px] font-semibold',
                          run.status === 'COMPLETED' &&
                            'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          run.status === 'RUNNING' &&
                            'border-primary/30 bg-primary/10 text-primary animate-pulse',
                          run.status === 'FAILED' &&
                            'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                          run.status === 'CANCELLED' &&
                            'border-border bg-muted text-muted-foreground'
                        )}
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {run.processedRecords} / {run.totalRecords}
                    </td>
                    <td className="py-3 px-4 font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                      {run.migratedRecords}
                    </td>
                    <td className="py-3 px-4 font-mono text-amber-600 dark:text-amber-400 font-medium">
                      {run.conflictRecords}
                    </td>
                    <td className="py-3 px-4 font-mono text-rose-600 dark:text-rose-400 font-medium">
                      {run.errorRecords}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => viewRunDetails(run.id)}
                        className="h-7 text-xs"
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-muted-foreground">
                    No encryption migration runs recorded yet. Click &quot;Preview Impact&quot; to
                    begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Run Details Modal */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="rounded-xl border border-border bg-card p-6 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Run Details: {selectedRun.id}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Mode: {selectedRun.mode} | Status: {selectedRun.status}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedRun(null)}
                className="h-8 w-8 p-0"
              >
                ✕
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3 p-3 bg-muted/20 rounded-lg border border-border/40">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Fingerprint</span>
                  <span className="font-mono text-[11px] truncate block">
                    {selectedRun.registryFingerprint.slice(0, 16)}...
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Active Key</span>
                  <span className="font-mono">{selectedRun.activeKeyId || 'none'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">
                    Safe for Retirement
                  </span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {selectedRun.safeForDatabaseKeyRetirement &&
                    selectedRun.safeForDatabaseKeyRetirement.length > 0
                      ? selectedRun.safeForDatabaseKeyRetirement.join(', ')
                      : 'None'}
                  </span>
                </div>
              </div>

              {/* Preview Impact Summary Counters */}
              {(() => {
                let currentV3 = 0;
                let oldKeyV3 = 0;
                let legacyV2 = 0;
                let legacyV1 = 0;
                let plaintext = 0;
                let errorTotal = 0;

                for (const t of selectedRun.targetStates || []) {
                  const s = t.inspectionStats;
                  if (s) {
                    currentV3 += s.currentV3 || 0;
                    oldKeyV3 += s.oldKeyV3 || 0;
                    legacyV2 += s.legacyV2 || 0;
                    legacyV1 += s.legacyV1 || 0;
                    plaintext += s.plaintext || 0;
                    errorTotal +=
                      (s.unavailableKey || 0) + (s.ambiguous || 0) + (s.unreadable || 0);
                  } else {
                    errorTotal += t.errorCount || 0;
                  }
                }
                const migrationCandidates = oldKeyV3 + legacyV2 + legacyV1 + plaintext;
                const blockingIssues = errorTotal;

                return (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-center">
                      <span className="text-[10px] uppercase font-semibold text-amber-600 dark:text-amber-400 block">
                        Migration Candidates
                      </span>
                      <span className="text-base font-bold text-amber-700 dark:text-amber-300 font-mono">
                        {migrationCandidates}
                      </span>
                    </div>
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-center">
                      <span className="text-[10px] uppercase font-semibold text-emerald-600 dark:text-emerald-400 block">
                        Already Current
                      </span>
                      <span className="text-base font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                        {currentV3}
                      </span>
                    </div>
                    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5 text-center">
                      <span className="text-[10px] uppercase font-semibold text-blue-600 dark:text-blue-400 block">
                        Legacy Plaintext
                      </span>
                      <span className="text-base font-bold text-blue-700 dark:text-blue-300 font-mono">
                        {plaintext}
                      </span>
                    </div>
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-center">
                      <span className="text-[10px] uppercase font-semibold text-rose-600 dark:text-rose-400 block">
                        Blocking Issues
                      </span>
                      <span className="text-base font-bold text-rose-700 dark:text-rose-300 font-mono">
                        {blockingIssues}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div>
                <h5 className="font-semibold text-xs text-foreground mb-2">
                  {selectedRun.mode === 'MIGRATE'
                    ? 'Migration Target Progress'
                    : 'Target Format Breakdown'}
                </h5>
                <div className="border border-border/60 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-muted/40 text-muted-foreground border-b border-border/40">
                      <tr>
                        <th className="py-2 px-3 font-semibold">Target ID</th>
                        {selectedRun.mode === 'MIGRATE' ? (
                          <>
                            <th className="py-2 px-3 font-semibold text-right">Processed</th>
                            <th className="py-2 px-3 font-semibold text-right">Migrated</th>
                            <th className="py-2 px-3 font-semibold text-right">Conflicts</th>
                            <th className="py-2 px-3 font-semibold text-right">Errors</th>
                          </>
                        ) : (
                          <>
                            <th className="py-2 px-3 font-semibold text-right">Current</th>
                            <th className="py-2 px-3 font-semibold text-right">Old Key</th>
                            <th className="py-2 px-3 font-semibold text-right">v2</th>
                            <th className="py-2 px-3 font-semibold text-right">v1</th>
                            <th className="py-2 px-3 font-semibold text-right">Plaintext</th>
                            <th className="py-2 px-3 font-semibold text-right">Errors</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {selectedRun.targetStates?.map(t => {
                        const s = t.inspectionStats;
                        return (
                          <tr key={t.id}>
                            <td className="py-2 px-3 font-mono font-medium">{t.targetId}</td>
                            {selectedRun.mode === 'MIGRATE' ? (
                              <>
                                <td className="py-2 px-3 font-mono text-right">
                                  {t.processedCount}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-emerald-600 dark:text-emerald-400">
                                  {t.migratedCount}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-amber-600 dark:text-amber-400">
                                  {t.conflictCount}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-rose-600 dark:text-rose-400">
                                  {t.errorCount}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="py-2 px-3 font-mono text-right text-emerald-600 dark:text-emerald-400">
                                  {s?.currentV3 ?? 0}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-amber-600 dark:text-amber-400">
                                  {s?.oldKeyV3 ?? 0}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-purple-600 dark:text-purple-400">
                                  {s?.legacyV2 ?? 0}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-indigo-600 dark:text-indigo-400">
                                  {s?.legacyV1 ?? 0}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-blue-600 dark:text-blue-400">
                                  {s?.plaintext ?? 0}
                                </td>
                                <td className="py-2 px-3 font-mono text-right text-rose-600 dark:text-rose-400">
                                  {s
                                    ? (s.unavailableKey ?? 0) +
                                      (s.ambiguous ?? 0) +
                                      (s.unreadable ?? 0)
                                    : t.errorCount}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-border/50">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRun(null)}
                className="h-8 text-xs"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
