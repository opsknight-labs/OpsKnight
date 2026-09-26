'use client';

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import TablePaginationFooter from '@/components/ui/TablePaginationFooter';
import { notify as toast } from '@/lib/toast';
import type {
  WarRoomDiagnosticsSnapshot,
  WarRoomOperationalSnapshot,
} from '@/lib/war-room/operations/types';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  Clock3,
  Layers,
  Users,
  Wrench,
  RefreshCw,
  Send,
  Layers2,
  UserPlus,
  Trash2,
  Filter,
  Lock,
} from 'lucide-react';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';

function healthBadgeVariant(health: string): string {
  switch (health) {
    case 'HEALTHY':
      return 'border-emerald-300 text-emerald-700 bg-emerald-50';
    case 'DEGRADED':
      return 'border-amber-300 text-amber-700 bg-amber-50';
    case 'DRIFTED':
      return 'border-violet-300 text-violet-700 bg-violet-50';
    case 'UNAVAILABLE':
      return 'border-slate-300 text-slate-600 bg-slate-50';
    case 'UNKNOWN':
      return 'border-blue-300 text-blue-700 bg-blue-50';
    default:
      return 'border-border text-muted-foreground';
  }
}

function stateBadgeVariant(state: string): string {
  if (state === 'READY') return 'border-emerald-300 text-emerald-700 bg-emerald-50';
  if (state === 'PROVISIONING' || state === 'AMBIGUOUS')
    return 'border-amber-300 text-amber-700 bg-amber-50';
  if (state === 'CLOSING') return 'border-blue-300 text-blue-700 bg-blue-50';
  if (state === 'CLOSED' || state === 'ARCHIVED')
    return 'border-slate-300 text-slate-600 bg-slate-50';
  if (state === 'FAILED') return 'border-red-300 text-red-700 bg-red-50';
  return 'border-border text-muted-foreground';
}

type Props = {
  snapshots: WarRoomOperationalSnapshot[];
  fleetSummary?: import('@/lib/war-room/operations/types').IntegrationHealthSummary | null;
};

const PAGE_SIZE = 15;

export default function WarRoomOperationsSection({ snapshots, fleetSummary }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Map<string, WarRoomDiagnosticsSnapshot | null>>(
    new Map()
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Pagination & Filtering state (default 15 items per page)
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<string>('ALL');

  // Fleet summary is authoritative for counts; the paginated table is only a view.
  const healthy = fleetSummary
    ? fleetSummary.healthyRooms
    : snapshots.filter(s => s.operationalHealth === 'HEALTHY').length;
  const degraded = fleetSummary
    ? fleetSummary.degradedRooms
    : snapshots.filter(s => s.operationalHealth === 'DEGRADED').length;
  const drifted = fleetSummary
    ? fleetSummary.driftedRooms
    : snapshots.filter(s => s.operationalHealth === 'DRIFTED').length;
  const unavailable = fleetSummary
    ? fleetSummary.unavailableRooms
    : snapshots.filter(s => s.operationalHealth === 'UNAVAILABLE').length;
  const unknown = fleetSummary
    ? fleetSummary.unknownRooms
    : snapshots.filter(s => s.operationalHealth === 'UNKNOWN').length;
  const cleanupPending = fleetSummary
    ? fleetSummary.externalCleanupPending
    : snapshots.filter(s => s.externalCleanupPending).length;

  // Filter snapshots by health status and search query
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter(s => {
      if (healthFilter === 'CLEANUP_PENDING' && !s.externalCleanupPending) return false;
      if (
        healthFilter !== 'ALL' &&
        healthFilter !== 'CLEANUP_PENDING' &&
        s.operationalHealth !== healthFilter
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchInc = s.incidentId.toLowerCase().includes(q);
        const matchRoom = s.warRoomId.toLowerCase().includes(q);
        const matchProv = s.provider.toLowerCase().includes(q);
        if (!matchInc && !matchRoom && !matchProv) return false;
      }
      return true;
    });
  }, [snapshots, healthFilter, searchQuery]);

  // Paginated window at 15 items per page
  const totalCount = filteredSnapshots.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedSnapshots = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredSnapshots.slice(start, start + PAGE_SIZE);
  }, [filteredSnapshots, currentPage]);

  const toggle = async (warRoomId: string) => {
    if (expandedId === warRoomId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(warRoomId);
    if (diagnostics.has(warRoomId)) return;
    setLoadingId(warRoomId);
    try {
      const res = await fetch(`/api/admin/war-rooms/${encodeURIComponent(warRoomId)}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json().catch(() => null)) as {
        data?: WarRoomDiagnosticsSnapshot;
      } | null;
      if (res.ok && body?.data) {
        setDiagnostics(prev => {
          const next = new Map(prev);
          next.set(warRoomId, body.data as WarRoomDiagnosticsSnapshot);
          return next;
        });
      } else {
        setDiagnostics(prev => {
          const next = new Map(prev);
          next.set(warRoomId, null);
          return next;
        });
      }
    } catch {
      setDiagnostics(prev => {
        const next = new Map(prev);
        next.set(warRoomId, null);
        return next;
      });
    } finally {
      setLoadingId(null);
    }
  };

  if (snapshots.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">War-room Operations</h3>
          <Badge variant="outline" className="text-[10px]">
            No rooms
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          No war rooms have been provisioned yet. Trigger an incident that meets the auto-create
          threshold or create one manually to see the operational table here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">War-room Operations</h3>
          <Badge variant="outline" className="text-[10px]">
            {snapshots.length} total
          </Badge>
          {cleanupPending > 0 && (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-700 bg-amber-50 text-[10px]"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              {cleanupPending} cleanup pending
            </Badge>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-64">
          <Input
            placeholder="Search incident or room…"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* Filter status pills */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
        <span className="text-[11px] text-muted-foreground mr-1 flex items-center gap-1">
          <Filter className="h-3 w-3" /> Filter:
        </span>
        <Button
          variant={healthFilter === 'ALL' ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-[11px] px-2.5"
          onClick={() => {
            setHealthFilter('ALL');
            setPage(1);
          }}
        >
          All ({snapshots.length})
        </Button>
        <Button
          variant={healthFilter === 'HEALTHY' ? 'default' : 'outline'}
          size="sm"
          className={`h-7 text-[11px] px-2.5 ${healthFilter !== 'HEALTHY' ? 'border-emerald-300 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-50' : ''}`}
          onClick={() => {
            setHealthFilter('HEALTHY');
            setPage(1);
          }}
        >
          Healthy ({healthy})
        </Button>
        <Button
          variant={healthFilter === 'DEGRADED' ? 'default' : 'outline'}
          size="sm"
          className={`h-7 text-[11px] px-2.5 ${healthFilter !== 'DEGRADED' ? 'border-amber-300 text-amber-700 bg-amber-50/50 hover:bg-amber-50' : ''}`}
          onClick={() => {
            setHealthFilter('DEGRADED');
            setPage(1);
          }}
        >
          Degraded ({degraded})
        </Button>
        <Button
          variant={healthFilter === 'DRIFTED' ? 'default' : 'outline'}
          size="sm"
          className={`h-7 text-[11px] px-2.5 ${healthFilter !== 'DRIFTED' ? 'border-violet-300 text-violet-700 bg-violet-50/50 hover:bg-violet-50' : ''}`}
          onClick={() => {
            setHealthFilter('DRIFTED');
            setPage(1);
          }}
        >
          Drifted ({drifted})
        </Button>
        {cleanupPending > 0 && (
          <Button
            variant={healthFilter === 'CLEANUP_PENDING' ? 'default' : 'outline'}
            size="sm"
            className={`h-7 text-[11px] px-2.5 ${healthFilter !== 'CLEANUP_PENDING' ? 'border-amber-400 text-amber-800 bg-amber-100/60 hover:bg-amber-100' : ''}`}
            onClick={() => {
              setHealthFilter('CLEANUP_PENDING');
              setPage(1);
            }}
          >
            Cleanup Pending ({cleanupPending})
          </Button>
        )}
        <Button
          variant={healthFilter === 'UNAVAILABLE' ? 'default' : 'outline'}
          size="sm"
          className={`h-7 text-[11px] px-2.5 ${healthFilter !== 'UNAVAILABLE' ? 'border-slate-300 text-slate-600 bg-slate-50 hover:bg-slate-100' : ''}`}
          onClick={() => {
            setHealthFilter('UNAVAILABLE');
            setPage(1);
          }}
        >
          Unavailable ({unavailable})
        </Button>
        <Button
          variant={healthFilter === 'UNKNOWN' ? 'default' : 'outline'}
          size="sm"
          className={`h-7 text-[11px] px-2.5 ${healthFilter !== 'UNKNOWN' ? 'border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100' : ''}`}
          onClick={() => {
            setHealthFilter('UNKNOWN');
            setPage(1);
          }}
        >
          Unknown ({unknown})
        </Button>
      </div>

      {filteredSnapshots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
          <Layers className="h-8 w-8 text-muted-foreground/50 mx-auto" />
          <p className="text-sm font-medium">No war rooms match the active filter or search</p>
          <p className="text-xs text-muted-foreground">
            Try resetting your search query or switching to &ldquo;All&rdquo;.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs mt-2"
            onClick={() => {
              setSearchQuery('');
              setHealthFilter('ALL');
              setPage(1);
            }}
          >
            Reset filters
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-b bg-muted/30">
                  <th className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">
                    Incident
                  </th>
                  <th className="text-left font-semibold py-2.5 px-3">Provider</th>
                  <th className="text-left font-semibold py-2.5 px-3">State & Channel Lock</th>
                  <th className="text-left font-semibold py-2.5 px-3">Health</th>
                  <th className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">
                    Projection
                  </th>
                  <th className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">Members</th>
                  <th className="text-left font-semibold py-2.5 px-3 whitespace-nowrap">
                    Last sync
                  </th>
                  <th className="text-left font-semibold py-2.5 px-3" />
                </tr>
              </thead>
              <tbody>
                {paginatedSnapshots.map(s => {
                  const isLocked =
                    s.state === 'CLOSING' || s.state === 'CLOSED' || s.state === 'ARCHIVED';
                  return (
                    <tr
                      key={s.warRoomId}
                      className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td
                        className="py-2.5 px-3 max-w-[180px] truncate font-medium"
                        title={s.incidentId}
                      >
                        {s.incidentId.slice(0, 8)}…
                        <span className="text-muted-foreground font-normal ml-1">
                          g{s.generation}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant="outline"
                          className="text-[10px] inline-flex items-center gap-1"
                        >
                          {s.provider === 'MICROSOFT_TEAMS' && (
                            <MicrosoftTeamsLogo className="h-3 w-3 shrink-0" />
                          )}
                          <span>{s.provider === 'MICROSOFT_TEAMS' ? 'Teams' : s.provider}</span>
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${stateBadgeVariant(s.state)}`}
                          >
                            {s.state}
                          </Badge>
                          {isLocked && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-slate-300 text-slate-600 bg-slate-50 gap-1"
                            >
                              <Lock className="h-2.5 w-2.5" /> Locked
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${healthBadgeVariant(s.operationalHealth)}`}
                        >
                          {s.operationalHealth}
                        </Badge>
                        {s.externalCleanupPending && (
                          <div className="text-[10px] text-amber-700 mt-0.5">cleanup pending</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={
                            s.projectionBehind
                              ? 'text-amber-700 font-semibold'
                              : 'text-muted-foreground'
                          }
                        >
                          {s.lastProjectedVersion}/{s.projectionVersion}
                        </span>
                        {s.projectionBehind && (
                          <span className="ml-1 text-[10px] text-amber-700">
                            lag {s.projectionLag}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {s.participantCounts.present}/{s.participantCounts.desired}
                        </span>
                        {s.participantDrift > 0 && (
                          <span className="ml-1 text-[10px] text-amber-700">
                            drift {s.participantDrift}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground text-[11px]">
                        {s.lastReconciledAt
                          ? new Date(s.lastReconciledAt).toLocaleString()
                          : s.lastProjectedAt
                            ? new Date(s.lastProjectedAt).toLocaleString()
                            : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] px-2"
                          onClick={() => toggle(s.warRoomId)}
                        >
                          {expandedId === s.warRoomId ? (
                            <ChevronDown className="h-3 w-3 mr-1" />
                          ) : (
                            <ChevronRight className="h-3 w-3 mr-1" />
                          )}
                          Details
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 15-Item Pagination Footer */}
          {totalCount > 0 && (
            <TablePaginationFooter
              page={currentPage}
              pageSize={PAGE_SIZE}
              totalCount={totalCount}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {expandedId && (
        <div className="rounded-lg border bg-muted/20 p-4 text-xs space-y-3">
          {loadingId === expandedId ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock3 className="h-4 w-4 animate-spin" />
              Loading diagnostics…
            </div>
          ) : (
            (() => {
              const diag = expandedId ? (diagnostics.get(expandedId) ?? undefined) : undefined;
              return diag ? (
                <DiagnosticsDetail diag={diag} />
              ) : (
                <div className="text-muted-foreground">
                  Unable to load diagnostics for this war room.
                </div>
              );
            })()
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Deterministic health: HEALTHY = authorized + permissions + healthy + no debt + current;
        DEGRADED = recoverable; UNAVAILABLE = integration/destination/bot disabled; DRIFTED =
        resource identity drift or externalCleanupPending; UNKNOWN = provider API unavailable (not
        resource missing).
      </p>
    </div>
  );
}

function RepairActions({
  warRoomId,
  state,
  externalCleanupPending,
}: {
  warRoomId: string;
  state: string;
  externalCleanupPending?: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const run = async (action: string) => {
    setPending(action);
    try {
      const res = await fetch(`/api/admin/war-rooms/${encodeURIComponent(warRoomId)}/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: { jobId?: string; jobType?: string };
      };
      if (res.ok) {
        toast.success(
          `${action} enqueued${body?.data?.jobType ? ` (${body.data.jobType})` : ''} — durable engine will apply via adapter.`
        );
      } else {
        toast.error(body?.error ?? `${action} was not accepted (${res.status})`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Repair request failed');
    } finally {
      setPending(null);
    }
  };
  const projectionDisabled = !['READY', 'CLOSING'].includes(state);
  const participantDisabled = !['READY', 'CLOSING'].includes(state);
  const cleanupDisabled =
    externalCleanupPending !== true || !['CLOSED', 'ARCHIVED'].includes(state);
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Wrench className="h-3.5 w-3.5" /> Safe repair actions
      </div>
      <p className="text-[11px] text-muted-foreground">
        UI → Admin API → RBAC + state gate → enqueue canonical durable job → existing engine →
        adapter. Verify Teams channel runs Graph channel health probe (marker scan), then health
        reconcile. Idempotent; never calls Graph directly. Duplicate requests reuse the pending job.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={pending !== null}
          onClick={() => run('TEST_CONNECTION')}
          title="Graph Teams channel health probe (marker scan) via durable job, then health reconcile."
        >
          <Send className="h-3 w-3 mr-1" />
          {pending === 'TEST_CONNECTION' ? 'Queuing…' : 'Verify Teams channel'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={pending !== null}
          onClick={() => run('RECONCILE')}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          {pending === 'RECONCILE' ? 'Queuing…' : 'Reconcile'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={pending !== null || projectionDisabled}
          onClick={() => run('RETRY_PROJECTION')}
          title={projectionDisabled ? 'Only while READY or CLOSING' : undefined}
        >
          <Layers2 className="h-3 w-3 mr-1" />
          Retry projection
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={pending !== null || participantDisabled}
          onClick={() => run('RETRY_PARTICIPANT_SYNC')}
          title={participantDisabled ? 'Only while READY or CLOSING' : undefined}
        >
          <UserPlus className="h-3 w-3 mr-1" />
          Retry participant sync
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={pending !== null || cleanupDisabled}
          onClick={() => run('RETRY_EXTERNAL_CLEANUP')}
          title={cleanupDisabled ? 'Only when cleanup pending and CLOSED/ARCHIVED' : undefined}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Retry external cleanup
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={pending !== null}
          onClick={() => run('REFRESH_PERMISSIONS')}
        >
          <ShieldCheck className="h-3 w-3 mr-1" />
          Refresh permissions
        </Button>
      </div>
    </div>
  );
}

function DiagnosticsRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono break-all">{value ?? '—'}</span>
    </div>
  );
}

function DiagnosticsDetail({ diag }: { diag: WarRoomDiagnosticsSnapshot }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 font-semibold">
        <Activity className="h-4 w-4" /> Diagnostics — {diag.warRoomId.slice(0, 8)}… g
        {diag.generation}
        {diag.externalCleanupPending && (
          <Badge
            variant="outline"
            className="border-amber-300 text-amber-700 bg-amber-50 text-[10px]"
          >
            externalCleanupPending
          </Badge>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Incident / Provider
          </div>
          <DiagnosticsRow
            label="Incident"
            value={`${diag.incidentTitle ?? diag.incidentId} (${diag.incidentStatus ?? '—'})`}
          />
          <DiagnosticsRow label="Provider" value={diag.provider} />
          <DiagnosticsRow label="Generation" value={String(diag.generation)} />
          <DiagnosticsRow label="State" value={diag.state} />
          <DiagnosticsRow
            label="Health"
            value={`${diag.operationalHealth} / ${diag.healthState}`}
          />
          <DiagnosticsRow
            label="Health reason"
            value={
              diag.healthReasonCode
                ? `${diag.healthReasonCode}: ${diag.healthReasonMessage ?? ''}`
                : diag.lastErrorCode
                  ? `${diag.lastErrorCode}: ${diag.lastError ?? ''}`.slice(0, 200)
                  : '—'
            }
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Destination / Channel
          </div>
          <DiagnosticsRow
            label="Destination"
            value={
              diag.destination
                ? `${diag.destination.id ?? '—'} ${diag.destination.enabled ? 'enabled' : 'disabled'} warRoom:${diag.destination.warRoomEnabled ? 'on' : 'off'}`
                : (diag.destinationId ?? '—')
            }
          />
          <DiagnosticsRow label="Tenant" value={diag.providerTenantId} />
          <DiagnosticsRow
            label="Team"
            value={diag.providerContainerId ?? diag.destination?.teamId ?? '—'}
          />
          <DiagnosticsRow
            label="Channel"
            value={
              diag.providerChannelId
                ? `${diag.providerChannelId} (${diag.providerChannelName ?? ''})`
                : '—'
            }
          />
          <DiagnosticsRow
            label="Channel URL"
            value={
              (diag as unknown as { providerChannelUrl?: string | null }).providerChannelUrl ?? '—'
            }
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Projection
          </div>
          <DiagnosticsRow
            label="Version"
            value={`${diag.lastProjectedVersion}/${diag.projectionVersion} lag ${diag.projectionLag}`}
          />
          <DiagnosticsRow label="Last projected" value={diag.lastProjectedAt} />
          <DiagnosticsRow label="Last reconciled" value={diag.lastReconciledAt} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Participant sync
          </div>
          <DiagnosticsRow
            label="Counts"
            value={`present ${diag.participantCounts.present}/${diag.participantCounts.desired} pending ${diag.participantCounts.pending} failed ${diag.participantCounts.failed} stale ${diag.participantCounts.desiredStale} drift ${diag.participantDrift}`}
          />
          <DiagnosticsRow
            label="Members"
            value={
              diag.participants.length === 0
                ? '—'
                : diag.participants
                    .map(
                      p => `${p.source}:${p.state}${p.lastErrorCode ? `(${p.lastErrorCode})` : ''}`
                    )
                    .join(', ')
                    .slice(0, 400)
            }
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Provisioning
          </div>
          <DiagnosticsRow label="Create attempted" value={diag.provisioning.createAttemptedAt} />
          <DiagnosticsRow label="Planned name" value={diag.provisioning.plannedExternalName} />
          <DiagnosticsRow
            label="Command message"
            value={
              diag.provisioning.commandMessageId
                ? `${diag.provisioning.commandMessageId} (${diag.provisioning.commandConversationId ?? ''})`
                : '—'
            }
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Closing / Cleanup
          </div>
          <DiagnosticsRow label="Close requested" value={diag.closing?.closeRequestedAt ?? '—'} />
          <DiagnosticsRow
            label="Closed / Archived"
            value={`${diag.closing?.closedAt ?? '—'} / ${diag.closing?.archivedAt ?? '—'}`}
          />
          <DiagnosticsRow
            label="Cleanup pending"
            value={
              diag.cleanup.externalCleanupPending
                ? `${diag.cleanup.externalCleanupReason ?? 'pending'} @ ${diag.cleanup.externalCleanupLastAttemptAt ?? '—'}`
                : 'false'
            }
          />
          <DiagnosticsRow
            label="Cleanup completed"
            value={diag.cleanup.externalCleanupCompletedAt}
          />
        </div>
      </div>
      <RepairActions
        warRoomId={diag.warRoomId}
        state={diag.state}
        externalCleanupPending={diag.externalCleanupPending}
      />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" />
        No secrets or tokens are surfaced in diagnostics.
      </div>
    </div>
  );
}
