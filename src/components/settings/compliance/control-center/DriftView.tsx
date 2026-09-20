'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Filter, RefreshCw, Search, ArrowRight, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { DriftStatusBadge } from './DriftStatusBadge';
import { DriftKindBadge } from './DriftKindBadge';
import { DriftDetailDrawer, type DriftDetailEventData } from './DriftDetailDrawer';
import type { ComplianceDriftStatus } from '@/lib/compliance/drift/types';

interface DriftViewProps {
  readonly canManageDrift?: boolean;
  readonly onSelectControl?: (controlId: string) => void;
  readonly onNavigateToEvidence?: (controlId: string) => void;
}

export function DriftView({
  canManageDrift = false,
  onSelectControl,
  onNavigateToEvidence,
}: DriftViewProps) {
  const [events, setEvents] = useState<DriftDetailEventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<ComplianceDriftStatus | 'ALL'>('ALL');
  const [kindFilter, setKindFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedEvent, setSelectedEvent] = useState<DriftDetailEventData | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const fetchDriftEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (kindFilter !== 'ALL') params.set('kind', kindFilter);

      const res = await fetch(`/api/compliance/drift?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to load drift events');
      }
      setEvents(json.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading drift events');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter]);

  useEffect(() => {
    fetchDriftEvents();
  }, [fetchDriftEvents]);

  const handleOpenDetail = (event: DriftDetailEventData) => {
    setSelectedEvent(event);
    setIsDrawerOpen(true);
  };

  const handleAcknowledged = (eventId: string) => {
    setEvents(prev =>
      prev.map(e =>
        e.id === eventId
          ? { ...e, status: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() }
          : e
      )
    );
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(prev =>
        prev ? { ...prev, status: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() } : null
      );
    }
  };

  const filteredEvents = events.filter(ev => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (ev.controlId && ev.controlId.toLowerCase().includes(q)) ||
      ev.summary.toLowerCase().includes(q) ||
      ev.kind.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search control ID or summary..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-xs rounded-md border border-border bg-background w-64 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as ComplianceDriftStatus | 'ALL')}
              className="py-1.5 px-2.5 text-xs rounded-md border border-border bg-background focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </select>

            <select
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value)}
              className="py-1.5 px-2.5 text-xs rounded-md border border-border bg-background focus:outline-none"
            >
              <option value="ALL">All Drift Kinds</option>
              <option value="CONTROL_STATUS_REGRESSION">Status Regression</option>
              <option value="CONTROL_UNVERIFIED">Verification Gap</option>
              <option value="FINDING_SET_CHANGED">Finding Changes</option>
              <option value="EVIDENCE_INTEGRITY_MISMATCH">Integrity Mismatch</option>
              <option value="EVALUATOR_VERSION_CHANGED">Evaluator Version</option>
              <option value="FRAMEWORK_LIFECYCLE_CHANGED">Framework Lifecycle</option>
            </select>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={fetchDriftEvents}
          disabled={loading}
          className="text-xs h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Events List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-xs">
          Loading compliance drift events...
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground text-xs space-y-2">
          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 opacity-80" />
          <div className="font-semibold text-foreground">No Compliance Drift Episodes</div>
          <div>No technical state changes match the selected filter criteria.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map(event => (
            <Card
              key={event.id}
              onClick={() => handleOpenDetail(event)}
              className="cursor-pointer border border-border bg-card hover:border-primary/50 transition-colors"
            >
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-foreground border">
                      {event.controlId ?? 'System'}
                    </span>
                    <DriftKindBadge kind={event.kind} />
                    <DriftStatusBadge status={event.status} />
                    {event.occurrenceCount > 1 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {event.occurrenceCount} occurrences
                      </Badge>
                    )}
                  </div>

                  <div className="text-xs text-foreground font-medium">{event.summary}</div>

                  {event.previousStatus && event.currentStatus && (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>Transition:</span>
                      <span className="font-mono">{event.previousStatus}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-mono font-semibold text-foreground">
                        {event.currentStatus}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex sm:flex-col items-end justify-between sm:justify-center text-[11px] text-muted-foreground shrink-0 space-y-1">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>First: {new Date(event.firstDetectedAt).toLocaleDateString()}</span>
                  </div>
                  <div>Last: {new Date(event.lastObservedAt).toLocaleTimeString()}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Drawer */}
      <DriftDetailDrawer
        event={selectedEvent}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        canManageDrift={canManageDrift}
        onAcknowledged={handleAcknowledged}
        onSelectControl={onSelectControl}
        onNavigateToEvidence={onNavigateToEvidence}
      />
    </div>
  );
}
