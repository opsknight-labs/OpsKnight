'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { ShieldAlert, Plus, Unlock, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { notify } from '@/lib/toast';

interface HoldItem {
  id: string;
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST';
  scopeId: string;
  reason: string;
  externalReference: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED';
  createdById: string | null;
  releasedById: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  releasedAt: string | null;
  createdBy: { id: string; name: string; email: string } | null;
  releasedBy: { id: string; name: string; email: string } | null;
}

export default function RetentionHoldsPanel() {
  const [holds, setHolds] = useState<HoldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'ALL'>(
    'ACTIVE'
  );
  const [scopeFilter, setScopeFilter] = useState<string>('ALL');

  // Create Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createScopeType, setCreateScopeType] = useState<'USER' | 'INCIDENT' | 'PRIVACY_REQUEST'>(
    'USER'
  );
  const [createScopeId, setCreateScopeId] = useState('');
  const [createReason, setCreateReason] = useState('');
  const [createReference, setCreateReference] = useState('');
  const [createExpiresAt, setCreateExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  // Release Modal state
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [selectedHold, setSelectedHold] = useState<HoldItem | null>(null);
  const [releasing, setReleasing] = useState(false);

  const fetchHolds = useCallback(
    async (reset = true, cursorToUse?: string | null) => {
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'ALL') params.set('status', statusFilter);
        if (scopeFilter !== 'ALL') params.set('scopeType', scopeFilter);
        if (!reset && cursorToUse) params.set('cursor', cursorToUse);

        const res = await fetch(`/api/compliance/retention-holds?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load retention holds');
        const data = await res.json();
        if (reset) {
          setHolds(data.holds || []);
        } else {
          setHolds(prev => [...prev, ...(data.holds || [])]);
        }
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        notify.error(err instanceof Error ? err.message : 'Error loading retention holds');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [statusFilter, scopeFilter]
  );

  useEffect(() => {
    fetchHolds(true);
  }, [fetchHolds]);

  const handleCreateHold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createScopeId.trim() || !createReason.trim()) {
      notify.error('Resource ID and Reason are required');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/compliance/retention-holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeType: createScopeType,
          scopeId: createScopeId.trim(),
          reason: createReason.trim(),
          externalReference: createReference.trim() || null,
          expiresAt: createExpiresAt ? new Date(createExpiresAt).toISOString() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.message || data.error?.userMessage || 'Failed to create retention hold'
        );
      }

      notify.success('Retention hold created successfully');
      setCreateOpen(false);
      setCreateScopeId('');
      setCreateReason('');
      setCreateReference('');
      setCreateExpiresAt('');
      fetchHolds();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to create hold');
    } finally {
      setCreating(false);
    }
  };

  const handleReleaseHold = async () => {
    if (!selectedHold) return;

    setReleasing(true);
    try {
      const res = await fetch(`/api/compliance/retention-holds/${selectedHold.id}/release`, {
        method: 'POST',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error?.userMessage || 'Failed to release hold');
      }

      notify.success(
        data.wasAlreadyReleased ? 'Hold was already released' : 'Retention hold released'
      );
      setReleaseOpen(false);
      setSelectedHold(null);
      fetchHolds();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to release hold');
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-6 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h3 className="text-base font-semibold text-foreground">Retention Holds</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Active holds prevent specified resources from being purged during automated cleanup and
            block subject erasure.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchHolds()}
            disabled={loading}
            className="text-xs h-8"
          >
            <RotateCcw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="text-xs h-8 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Hold
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
        <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
        {(['ACTIVE', 'EXPIRED', 'RELEASED', 'ALL'] as const).map(st => (
          <Button
            key={st}
            variant={statusFilter === st ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setStatusFilter(st)}
            className="text-xs h-7 px-2.5"
          >
            {st}
          </Button>
        ))}

        <div className="h-4 w-px bg-border/60 mx-2" />

        <span className="text-xs font-medium text-muted-foreground mr-1">Scope:</span>
        {['ALL', 'USER', 'INCIDENT', 'PRIVACY_REQUEST'].map(sc => (
          <Button
            key={sc}
            variant={scopeFilter === sc ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setScopeFilter(sc)}
            className="text-xs h-7 px-2.5"
          >
            {sc}
          </Button>
        ))}
      </div>

      {/* Holds Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-[11px] text-muted-foreground uppercase bg-muted/40 border-b border-border/60">
            <tr>
              <th className="px-3 py-2.5">Scope</th>
              <th className="px-3 py-2.5">Resource ID</th>
              <th className="px-3 py-2.5">Reason</th>
              <th className="px-3 py-2.5">Reference</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {loading && holds.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  Loading retention holds...
                </td>
              </tr>
            ) : holds.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No retention holds found for the selected filter.
                </td>
              </tr>
            ) : (
              holds.map(hold => (
                <tr key={hold.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5 font-mono">
                    <Badge variant="outline" className="text-[10px]">
                      {hold.scopeType}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 font-mono font-medium">{hold.scopeId}</td>
                  <td
                    className="px-3 py-2.5 max-w-xs truncate text-foreground/90"
                    title={hold.reason}
                  >
                    {hold.reason}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {hold.externalReference || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {hold.status === 'ACTIVE' && (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                        ACTIVE
                      </Badge>
                    )}
                    {hold.status === 'EXPIRED' && (
                      <Badge variant="secondary" className="text-[10px]">
                        EXPIRED
                      </Badge>
                    )}
                    {hold.status === 'RELEASED' && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        RELEASED
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(hold.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {hold.status === 'ACTIVE' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedHold(hold);
                          setReleaseOpen(true);
                        }}
                        className="h-7 px-2 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 text-xs"
                      >
                        <Unlock className="h-3 w-3 mr-1" />
                        Release
                      </Button>
                    ) : (
                      <span className="text-muted-foreground/60 text-[11px]">No action</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {nextCursor && (
          <div className="flex justify-center p-3 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchHolds(false, nextCursor)}
              disabled={loadingMore}
              className="text-xs"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Loading more...
                </>
              ) : (
                'Load More Holds'
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4 animate-in fade-in-50">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h4 className="text-base font-semibold text-foreground">Create Retention Hold</h4>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateHold} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <Label htmlFor="scopeType">Scope Type</Label>
                <select
                  id="scopeType"
                  value={createScopeType}
                  onChange={e => setCreateScopeType(e.target.value as typeof createScopeType)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="USER">User</option>
                  <option value="INCIDENT">Incident</option>
                  <option value="PRIVACY_REQUEST">Privacy Request</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="scopeId">Resource ID</Label>
                <Input
                  id="scopeId"
                  placeholder={
                    createScopeType === 'USER'
                      ? 'usr_...'
                      : createScopeType === 'INCIDENT'
                        ? 'inc_...'
                        : 'prv_...'
                  }
                  value={createScopeId}
                  onChange={e => setCreateScopeId(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (Compliance Evidence)</Label>
                <textarea
                  id="reason"
                  rows={3}
                  placeholder="e.g. Legal investigation or pending litigation..."
                  value={createReason}
                  onChange={e => setCreateReason(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reference">External Reference (Optional)</Label>
                <Input
                  id="reference"
                  placeholder="LEGAL-431, AUDIT-2026-Q3..."
                  value={createReference}
                  onChange={e => setCreateReference(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expiresAt">Expires At (Optional)</Label>
                <Input
                  id="expiresAt"
                  type="datetime-local"
                  value={createExpiresAt}
                  onChange={e => setCreateExpiresAt(e.target.value)}
                  className="text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Leave blank for hold to remain active indefinitely until explicitly released.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={creating}>
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Create Hold
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Release Confirmation Dialog */}
      {releaseOpen && selectedHold && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4 animate-in fade-in-50">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-semibold text-foreground">Release retention hold?</h4>
                <p className="text-xs text-muted-foreground">
                  Releasing this hold will allow the resource to be cleaned up if it meets the
                  configured retention thresholds.
                </p>
              </div>
            </div>

            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scope:</span>
                <span className="font-mono font-medium">{selectedHold.scopeType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Resource ID:</span>
                <span className="font-mono font-medium">{selectedHold.scopeId}</span>
              </div>
              {selectedHold.externalReference && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reference:</span>
                  <span className="font-medium">{selectedHold.externalReference}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created:</span>
                <span>{new Date(selectedHold.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              After release, this resource may become eligible for the organization&apos;s
              configured retention cleanup. The hold record itself is preserved as compliance
              evidence.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReleaseOpen(false);
                  setSelectedHold(null);
                }}
                disabled={releasing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleReleaseHold}
                disabled={releasing}
              >
                {releasing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Release Hold
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
