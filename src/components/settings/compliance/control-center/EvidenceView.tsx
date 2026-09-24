'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { ShieldCheck, ShieldAlert, RefreshCw, Filter, Loader2, X } from 'lucide-react';
import type { ComplianceEvidenceRecord } from '@/lib/compliance/evidence/types';
import { ComplianceEvidenceViewer } from '../ComplianceEvidenceViewer';

interface EvidenceViewProps {
  readonly initialControlFilter?: string | null;
  readonly onClearControlFilter?: () => void;
  readonly canReadEvidence?: boolean;
}

export function EvidenceView({
  initialControlFilter = null,
  onClearControlFilter,
  canReadEvidence = true,
}: EvidenceViewProps) {
  const [evidenceList, setEvidenceList] = useState<ComplianceEvidenceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [integrityFilter, setIntegrityFilter] = useState<'ALL' | 'VALID' | 'MISMATCH'>('ALL');
  const [controlFilter, setControlFilter] = useState<string | null>(initialControlFilter);

  const [selectedEvidence, setSelectedEvidence] = useState<ComplianceEvidenceRecord | null>(null);

  useEffect(() => {
    setControlFilter(initialControlFilter);
  }, [initialControlFilter]);

  const fetchEvidence = useCallback(async () => {
    if (!canReadEvidence) return;
    setIsLoading(true);
    setError(null);
    try {
      const search = searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : '';
      const url = controlFilter
        ? `/api/compliance/controls/${controlFilter}/evidence?limit=50`
        : `/api/compliance/evidence?limit=50${search}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error?.message || `HTTP ${res.status}: Failed to load evidence ledger`
        );
      }
      if (json.data?.evidence) {
        setEvidenceList(json.data.evidence);
        setNextCursor(json.data.nextCursor ?? null);
        setHasMore(Boolean(json.data.hasMore));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch evidence records');
    } finally {
      setIsLoading(false);
    }
  }, [controlFilter, canReadEvidence, searchQuery]);

  useEffect(() => {
    fetchEvidence();
  }, [fetchEvidence]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore || !canReadEvidence) return;
    setIsLoadingMore(true);
    try {
      const url = controlFilter
        ? `/api/compliance/controls/${controlFilter}/evidence?limit=50&cursor=${encodeURIComponent(nextCursor)}`
        : `/api/compliance/evidence?limit=50&cursor=${encodeURIComponent(nextCursor)}${
            searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : ''
          }`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || `HTTP ${res.status}: Failed to load more evidence`);
      }
      if (json.data?.evidence) {
        setEvidenceList(prev => [...prev, ...json.data.evidence]);
        setNextCursor(json.data.nextCursor ?? null);
        setHasMore(Boolean(json.data.hasMore));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load more evidence');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const filteredEvidence = useMemo(() => {
    return evidenceList.filter(item => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesCollector = item.collectorId.toLowerCase().includes(q);
        const matchesHash = item.contentHash.toLowerCase().includes(q);
        const matchesControl = item.controlId.toLowerCase().includes(q);
        const matchesDesc = item.description?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesCollector && !matchesHash && !matchesControl && !matchesDesc) {
          return false;
        }
      }

      // Type
      if (typeFilter !== 'ALL' && item.type !== typeFilter) {
        return false;
      }

      // Integrity
      if (integrityFilter === 'VALID' && !item.integrityValid) return false;
      if (integrityFilter === 'MISMATCH' && item.integrityValid) return false;

      return true;
    });
  }, [evidenceList, searchQuery, typeFilter, integrityFilter]);

  if (!canReadEvidence) {
    return (
      <Card className="p-8 text-center border-dashed">
        <p className="text-xs text-muted-foreground">
          You do not have permission to inspect compliance evidence snapshots. Requires{' '}
          <code>COMPLIANCE_EVIDENCE_READ</code>.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error alert banner with retry */}
      {error && (
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-400">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchEvidence}
            className="h-7 text-xs border-rose-500/30 hover:bg-rose-500/20"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Control Filter Alert if set */}
      {controlFilter && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs text-sky-800 dark:text-sky-300">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 shrink-0" />
            <span>
              Filtered to evidence supporting control <strong>{controlFilter}</strong>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setControlFilter(null);
              if (onClearControlFilter) onClearControlFilter();
            }}
            className="h-6 text-xs px-2 gap-1"
          >
            <X className="h-3 w-3" />
            <span>Show All Controls</span>
          </Button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3.5 rounded-xl border bg-card/60">
        <div className="relative flex-1">
          <Input
            placeholder="Search by title, control ID, collector, or SHA-256 hash..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="text-xs h-9 bg-background/80"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            aria-label="Filter evidence by type"
            className="h-9 px-3 py-1 rounded-lg border bg-background/80 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="ALL">All Types</option>
            <option value="VERIFICATION_RESULT">Verification Result</option>
            <option value="CONFIGURATION_SNAPSHOT">Config Snapshot</option>
            <option value="SYSTEM_STATE">System State</option>
            <option value="CAPABILITY_CHECK">Capability Check</option>
            <option value="EXECUTION_SUMMARY">Execution Summary</option>
            <option value="EVALUATION_FAILURE">Evaluation Failure</option>
          </select>

          {/* Integrity Filter */}
          <select
            value={integrityFilter}
            onChange={e => setIntegrityFilter(e.target.value as 'ALL' | 'VALID' | 'MISMATCH')}
            aria-label="Filter evidence by cryptographic integrity"
            className="h-9 px-3 py-1 rounded-lg border bg-background/80 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="ALL">All Integrity</option>
            <option value="VALID">Verified Only</option>
            <option value="MISMATCH">Mismatches Only</option>
          </select>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchEvidence()}
            disabled={isLoading}
            className="h-9 text-xs px-3"
            title="Refresh Evidence Ledger"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Ledger Header */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>Showing {filteredEvidence.length} evidence record(s)</span>
        <span className="text-[11px]">Integrity checked using canonical SHA-256 digests</span>
      </div>

      {/* Evidence Table / List */}
      {isLoading && evidenceList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-xs">Loading evidence ledger...</p>
        </div>
      ) : filteredEvidence.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            No evidence records match the selected filters.
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredEvidence.map(item => (
            <div
              key={item.id}
              onClick={() => setSelectedEvidence(item)}
              className="p-3.5 rounded-xl border border-border/80 bg-card hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 group"
            >
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/60">
                    {item.controlId}
                  </span>
                  <Badge variant="outline" className="text-[11px] py-0">
                    {item.type}
                  </Badge>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    collector: {item.collectorId} v{item.collectorVersion}
                  </span>
                </div>

                <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {item.title}
                </h4>

                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                  <span>Collected: {new Date(item.collectedAt).toLocaleString()}</span>
                  <span>•</span>
                  <span className="font-mono truncate max-w-xs">
                    SHA-256: {item.contentHash.slice(0, 16)}...
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                {item.integrityValid ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold text-xs gap-1 py-1 px-2"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Verified</span>
                  </Badge>
                ) : (
                  <Badge
                    variant="destructive"
                    className="border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400 font-semibold text-xs gap-1 py-1 px-2"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span>Integrity Mismatch</span>
                  </Badge>
                )}

                <Button variant="outline" size="sm" className="text-xs h-8">
                  Inspect
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Load More */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={isLoadingMore}
            className="text-xs gap-1.5"
          >
            {isLoadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
            <span>Load More Records</span>
          </Button>
        </div>
      )}

      {/* Detailed Modal Viewer */}
      <ComplianceEvidenceViewer
        evidence={selectedEvidence}
        isOpen={Boolean(selectedEvidence)}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
}
