'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { notify as toast } from '@/lib/toast';
import type { WarRoomDiagnosticsSnapshot, WarRoomOperationalSnapshot } from '@/lib/war-room/operations/types';
import { Activity, ChevronDown, ChevronRight, AlertTriangle, ShieldCheck, Clock3, Layers, Users, Wrench, RefreshCw, Send, Layers2, UserPlus, Trash2 } from 'lucide-react';

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
  if (state === 'PROVISIONING' || state === 'AMBIGUOUS') return 'border-amber-300 text-amber-700 bg-amber-50';
  if (state === 'CLOSING') return 'border-blue-300 text-blue-700 bg-blue-50';
  if (state === 'CLOSED' || state === 'ARCHIVED') return 'border-slate-300 text-slate-600 bg-slate-50';
  if (state === 'FAILED') return 'border-red-300 text-red-700 bg-red-50';
  return 'border-border text-muted-foreground';
}

type Props = {
  snapshots: WarRoomOperationalSnapshot[];
};

export default function WarRoomOperationsSection({ snapshots }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, WarRoomDiagnosticsSnapshot | null>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const healthy = snapshots.filter(s => s.operationalHealth === 'HEALTHY').length;
  const degraded = snapshots.filter(s => s.operationalHealth === 'DEGRADED').length;
  const drifted = snapshots.filter(s => s.operationalHealth === 'DRIFTED').length;
  const unavailable = snapshots.filter(s => s.operationalHealth === 'UNAVAILABLE').length;
  const unknown = snapshots.filter(s => s.operationalHealth === 'UNKNOWN').length;
  const cleanupPending = snapshots.filter(s => s.externalCleanupPending).length;

  const toggle = async (warRoomId: string) => {
    if (expandedId === warRoomId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(warRoomId);
    // eslint-disable-next-line security/detect-object-injection -- warRoomId is a validated DB id used as a keyed cache, not an object prototype pollute
    if (diagnostics[warRoomId] !== undefined) return;
    setLoadingId(warRoomId);
    try {
      const res = await fetch(`/api/admin/war-rooms/${encodeURIComponent(warRoomId)}`, { headers: { 'Content-Type': 'application/json' } });
      const body = await res.json().catch(() => null) as { data?: WarRoomDiagnosticsSnapshot } | null;
      if (res.ok && body?.data) {
        setDiagnostics(prev => ({ ...prev, [warRoomId]: body.data as WarRoomDiagnosticsSnapshot }));
      } else {
        setDiagnostics(prev => ({ ...prev, [warRoomId]: null }));
      }
    } catch {
      setDiagnostics(prev => ({ ...prev, [warRoomId]: null }));
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
          <Badge variant="outline" className="text-[10px]">No rooms</Badge>
        </div>
        <p className="text-xs text-muted-foreground">No war rooms have been provisioned yet. Trigger an incident that meets the auto-create threshold or create one manually to see the operational table here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">War-room Operations</h3>
          <Badge variant="outline" className="text-[10px]">{snapshots.length} room(s)</Badge>
          {cleanupPending > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{cleanupPending} cleanup pending
            </Badge>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{healthy} healthy</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{degraded} degraded</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" />{drifted} drifted</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />{unavailable} unavailable</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />{unknown} unknown</span>
        </div>
      </div>

      {/* Summary chips (mobile) */}
      <div className="flex sm:hidden flex-wrap gap-1.5 text-[11px]">
        <Badge variant="outline" className="border-emerald-300 text-emerald-700 text-[10px]">{healthy} HEALTHY</Badge>
        <Badge variant="outline" className="border-amber-300 text-amber-700 text-[10px]">{degraded} DEGRADED</Badge>
        <Badge variant="outline" className="border-violet-300 text-violet-700 text-[10px]">{drifted} DRIFTED</Badge>
        <Badge variant="outline" className="border-slate-300 text-slate-600 text-[10px]">{unavailable} UNAVAILABLE</Badge>
        <Badge variant="outline" className="border-blue-300 text-blue-700 text-[10px]">{unknown} UNKNOWN</Badge>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] text-muted-foreground border-b">
              <th className="text-left font-semibold py-2 px-2 whitespace-nowrap">Incident</th>
              <th className="text-left font-semibold py-2 px-2">Provider</th>
              <th className="text-left font-semibold py-2 px-2">State</th>
              <th className="text-left font-semibold py-2 px-2">Health</th>
              <th className="text-left font-semibold py-2 px-2 whitespace-nowrap">Projection</th>
              <th className="text-left font-semibold py-2 px-2 whitespace-nowrap">Members</th>
              <th className="text-left font-semibold py-2 px-2 whitespace-nowrap">Last sync</th>
              <th className="text-left font-semibold py-2 px-2" />
            </tr>
          </thead>
          <tbody>
            {snapshots.map(s => (
              <tr key={s.warRoomId} className="border-b last:border-0 hover:bg-muted/20">
                <td className="py-2.5 px-2 max-w-[180px] truncate font-medium" title={s.incidentId}>{s.incidentId.slice(0, 8)}…<span className="text-muted-foreground font-normal ml-1">g{s.generation}</span></td>
                <td className="py-2.5 px-2">
                  <Badge variant="outline" className="text-[10px]">{s.provider === 'MICROSOFT_TEAMS' ? 'Teams' : s.provider}</Badge>
                </td>
                <td className="py-2.5 px-2">
                  <Badge variant="outline" className={`text-[10px] ${stateBadgeVariant(s.state)}`}>{s.state}</Badge>
                </td>
                <td className="py-2.5 px-2">
                  <Badge variant="outline" className={`text-[10px] ${healthBadgeVariant(s.operationalHealth)}`}>{s.operationalHealth}</Badge>
                  {s.externalCleanupPending && (
                    <div className="text-[10px] text-amber-700 mt-1">cleanup pending</div>
                  )}
                </td>
                <td className="py-2.5 px-2 whitespace-nowrap">
                  <span className={s.projectionBehind ? 'text-amber-700 font-semibold' : 'text-muted-foreground'}>
                    {s.lastProjectedVersion}/{s.projectionVersion}
                  </span>
                  {s.projectionBehind && <span className="ml-1 text-[10px] text-amber-700">lag {s.projectionLag}</span>}
                </td>
                <td className="py-2.5 px-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3 text-muted-foreground" />{s.participantCounts.present}/{s.participantCounts.desired}</span>
                  {s.participantDrift > 0 && <span className="ml-1 text-[10px] text-amber-700">drift {s.participantDrift}</span>}
                </td>
                <td className="py-2.5 px-2 whitespace-nowrap text-muted-foreground">
                  {s.lastReconciledAt ? new Date(s.lastReconciledAt).toLocaleString() : s.lastProjectedAt ? new Date(s.lastProjectedAt).toLocaleString() : '—'}
                </td>
                <td className="py-2.5 px-2">
                  <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={() => toggle(s.warRoomId)}>
                    {expandedId === s.warRoomId ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                    Details
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expandedId && (
        <div className="rounded-lg border bg-muted/20 p-4 text-xs space-y-3">
          {loadingId === expandedId ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Clock3 className="h-4 w-4 animate-spin" />Loading diagnostics…</div>
          ) : (() => {
              // eslint-disable-next-line security/detect-object-injection -- expandedId validated against DB ids, not prototype pollution
              const diag = expandedId ? diagnostics[expandedId] : undefined;
              return diag ? <DiagnosticsDetail diag={diag} /> : <div className="text-muted-foreground">Unable to load diagnostics for this war room.</div>;
            })()}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">Deterministic health: HEALTHY = authorized + permissions + healthy + no debt + current; DEGRADED = recoverable; UNAVAILABLE = integration/destination/bot disabled; DRIFTED = resource identity drift or externalCleanupPending; UNKNOWN = provider API unavailable (not resource missing).</p>
    </div>
  );
}

function RepairActions({ warRoomId, state }: { warRoomId: string; state: string }) {
  const [pending, setPending] = useState<string | null>(null);
  const run = async (action: string) => {
    setPending(action);
    try {
      const res = await fetch(`/api/admin/war-rooms/${encodeURIComponent(warRoomId)}/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; data?: { jobId?: string; jobType?: string } };
      if (res.ok) {
        toast.success(`${action} enqueued${body?.data?.jobType ? ` (${body.data.jobType})` : ''} — durable engine will apply via adapter.`);
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
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold"><Wrench className="h-3.5 w-3.5" /> Safe repair actions</div>
      <p className="text-[11px] text-muted-foreground">UI → Admin API → RBAC + state gate → enqueue canonical durable job → existing engine → adapter. Verify room runs Entra + Graph + bot + RSC + destination probe, then health reconcile. Idempotent; never calls Graph directly. Duplicate requests reuse the pending job.</p>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={pending !== null} onClick={() => run('TEST_CONNECTION')} title="Entra + Graph + bot + RSC + destination probe (durable). Then health reconcile."><Send className="h-3 w-3 mr-1" />{pending === 'TEST_CONNECTION' ? 'Queuing…' : 'Verify room (Entra+Graph+bot+RSC)'}</Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={pending !== null} onClick={() => run('RECONCILE')}><RefreshCw className="h-3 w-3 mr-1" />{pending === 'RECONCILE' ? 'Queuing…' : 'Reconcile'}</Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={pending !== null || projectionDisabled} onClick={() => run('RETRY_PROJECTION')} title={projectionDisabled ? 'Only while READY or CLOSING' : undefined}><Layers2 className="h-3 w-3 mr-1" />Retry projection</Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={pending !== null || participantDisabled} onClick={() => run('RETRY_PARTICIPANT_SYNC')} title={participantDisabled ? 'Only while READY or CLOSING' : undefined}><UserPlus className="h-3 w-3 mr-1" />Retry participant sync</Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={pending !== null} onClick={() => run('RETRY_EXTERNAL_CLEANUP')}><Trash2 className="h-3 w-3 mr-1" />Retry external cleanup</Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={pending !== null} onClick={() => run('REFRESH_PERMISSIONS')}><ShieldCheck className="h-3 w-3 mr-1" />Refresh permissions</Button>
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
        <Activity className="h-4 w-4" /> Diagnostics — {diag.warRoomId.slice(0, 8)}… g{diag.generation}
        {diag.externalCleanupPending && <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 text-[10px]">externalCleanupPending</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Incident / Provider</div>
          <DiagnosticsRow label="Incident" value={`${diag.incidentTitle ?? diag.incidentId} (${diag.incidentStatus ?? '—'})`} />
          <DiagnosticsRow label="Provider" value={diag.provider} />
          <DiagnosticsRow label="Generation" value={String(diag.generation)} />
          <DiagnosticsRow label="State" value={diag.state} />
          <DiagnosticsRow label="Health" value={`${diag.operationalHealth} / ${diag.healthState}`} />
          <DiagnosticsRow label="Health reason" value={diag.healthReasonCode ? `${diag.healthReasonCode}: ${diag.healthReasonMessage ?? ''}` : diag.lastErrorCode ? `${diag.lastErrorCode}: ${diag.lastError ?? ''}`.slice(0, 200) : '—'} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Destination / Channel</div>
          <DiagnosticsRow label="Destination" value={diag.destination ? `${diag.destination.id ?? '—'} ${diag.destination.enabled ? 'enabled' : 'disabled'} warRoom:${diag.destination.warRoomEnabled ? 'on' : 'off'}` : diag.destinationId ?? '—'} />
          <DiagnosticsRow label="Tenant" value={diag.providerTenantId} />
          <DiagnosticsRow label="Team" value={diag.providerContainerId ?? diag.destination?.teamId ?? '—'} />
          <DiagnosticsRow label="Channel" value={diag.providerChannelId ? `${diag.providerChannelId} (${diag.providerChannelName ?? ''})` : '—'} />
          <DiagnosticsRow label="Channel URL" value={(diag as unknown as { providerChannelUrl?: string | null }).providerChannelUrl ?? '—'} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Projection</div>
          <DiagnosticsRow label="Version" value={`${diag.lastProjectedVersion}/${diag.projectionVersion} lag ${diag.projectionLag}`} />
          <DiagnosticsRow label="Last projected" value={diag.lastProjectedAt} />
          <DiagnosticsRow label="Last reconciled" value={diag.lastReconciledAt} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Participant sync</div>
          <DiagnosticsRow label="Counts" value={`present ${diag.participantCounts.present}/${diag.participantCounts.desired} pending ${diag.participantCounts.pending} failed ${diag.participantCounts.failed} stale ${diag.participantCounts.desiredStale} drift ${diag.participantDrift}`} />
          <DiagnosticsRow label="Members" value={diag.participants.length === 0 ? '—' : diag.participants.map(p => `${p.source}:${p.state}${p.lastErrorCode ? `(${p.lastErrorCode})` : ''}`).join(', ').slice(0, 400)} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Provisioning</div>
          <DiagnosticsRow label="Create attempted" value={diag.provisioning.createAttemptedAt} />
          <DiagnosticsRow label="Planned name" value={diag.provisioning.plannedExternalName} />
          <DiagnosticsRow label="Command message" value={diag.provisioning.commandMessageId ? `${diag.provisioning.commandMessageId} (${diag.provisioning.commandConversationId ?? ''})` : '—'} />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Closing / Cleanup</div>
          <DiagnosticsRow label="Close requested" value={diag.closing?.closeRequestedAt ?? '—'} />
          <DiagnosticsRow label="Closed / Archived" value={`${diag.closing?.closedAt ?? '—'} / ${diag.closing?.archivedAt ?? '—'}`} />
          <DiagnosticsRow label="Cleanup pending" value={diag.cleanup.externalCleanupPending ? `${diag.cleanup.externalCleanupReason ?? 'pending'} @ ${diag.cleanup.externalCleanupLastAttemptAt ?? '—'}` : 'false'} />
          <DiagnosticsRow label="Cleanup completed" value={diag.cleanup.externalCleanupCompletedAt} />
        </div>
      </div>
      <RepairActions warRoomId={diag.warRoomId} state={diag.state} />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3" />No secrets or tokens are surfaced in diagnostics.
      </div>
    </div>
  );
}
