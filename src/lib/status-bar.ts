import { createDateTimeFormatterCache } from '@/lib/date-time-format';

/** One of the viewer's on-call shifts, trimmed to what the status bar shows. */
export type StatusBarShift = {
  scheduleId: string;
  scheduleName: string;
  start: string;
  end: string;
  /** The end is the lookahead limit, not a real handoff. */
  endClamped: boolean;
};

export type MyIncidentCounts = { assigned: number; unacked: number };

export type ActiveMaintenance = {
  /** Distinct visible services in maintenance (bounded; see getWorkspaceHealth). */
  count: number;
  serviceId: string;
  serviceName: string;
  endsAt: string;
};

export type StatusPageSeverity = 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE';

/** Workspace signals scoped to what the viewer can read; each is empty/null when inactive. */
export type WorkspaceHealth = {
  awaitingAck: number;
  slaAtRisk: number;
  maintenance: ActiveMaintenance | null;
  coverageGap: { count: number; scheduleId: string; scheduleName: string } | null;
  warRooms: { count: number; incidentId: string; title: string; since: string } | null;
  /** Worst enabled page that is not operational; `href` is null when the viewer cannot open settings. */
  statusPage: {
    status: StatusPageSeverity;
    pageName: string;
    more: number;
    href: string | null;
  } | null;
  runbooksRunning: number;
  /** Admins only: the oldest pending ingestion receipt has waited past the threshold. */
  ingestionDelayed: boolean;
  /** Server read time, so elapsed labels render the same on server and client. */
  asOf: number;
};

export const EMPTY_HEALTH: WorkspaceHealth = {
  awaitingAck: 0,
  slaAtRisk: 0,
  maintenance: null,
  coverageGap: null,
  warRooms: null,
  statusPage: null,
  runbooksRunning: 0,
  ingestionDelayed: false,
  asOf: 0,
};

export type SignalTone = 'critical' | 'elevated' | 'neutral' | 'info';
export type SignalIcon =
  'ack' | 'sla' | 'coverage' | 'maintenance' | 'warRoom' | 'statusPage' | 'runbook' | 'ingestion';

export type Signal = {
  key: string;
  label: string;
  detail: string;
  href: string | null;
  tone: SignalTone;
  icon: SignalIcon;
  /** Lower wins an inline slot; the rest go to the "+N" overflow. */
  priority: number;
};

const SEVERITY_LABEL: Record<StatusPageSeverity, string> = {
  DEGRADED: 'Degraded',
  PARTIAL_OUTAGE: 'Partial outage',
  MAJOR_OUTAGE: 'Major outage',
};

/** Compact elapsed time: `12m`, `3h 05m`, `2d`. */
export function compactElapsed(fromIso: string, now: number) {
  const mins = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  return `${Math.floor(mins / (24 * 60))}d`;
}

/** Every active right-side signal, in display order; inactive ones are absent. */
export function buildSignals(health: WorkspaceHealth, timeZone: string): Signal[] {
  const out: Signal[] = [];
  if (health.awaitingAck > 0)
    out.push({
      key: 'ack',
      label: awaitingAckLabel(health.awaitingAck),
      detail: awaitingAckDetail(health.awaitingAck),
      href: AWAITING_ACK_HREF,
      tone: 'elevated',
      icon: 'ack',
      priority: 5,
    });
  if (health.slaAtRisk > 0)
    out.push({
      key: 'sla',
      label: slaAtRiskLabel(health.slaAtRisk),
      detail: slaAtRiskDetail(health.slaAtRisk),
      href: SLA_AT_RISK_HREF,
      tone: 'critical',
      icon: 'sla',
      priority: 1,
    });
  const gap = health.coverageGap;
  if (gap)
    out.push({
      key: 'coverage',
      label:
        gap.count === 1
          ? `${gap.scheduleName} has no one on call`
          : `${gap.count} schedules with no one on call`,
      detail:
        gap.count === 1
          ? `${gap.scheduleName} has no one on call right now`
          : `${gap.count} schedules have no one on call right now, including ${gap.scheduleName}`,
      href: gap.count === 1 ? `/schedules/${gap.scheduleId}` : '/schedules',
      tone: 'critical',
      icon: 'coverage',
      priority: 1.5,
    });
  if (health.maintenance)
    out.push({
      key: 'maintenance',
      label: maintenanceLabel(health.maintenance),
      detail: maintenanceDetail(health.maintenance, timeZone),
      href: maintenanceHref(health.maintenance),
      tone: 'neutral',
      icon: 'maintenance',
      priority: 6,
    });
  const war = health.warRooms;
  if (war) {
    const elapsed = compactElapsed(war.since, health.asOf);
    out.push({
      key: 'warRoom',
      label: war.count === 1 ? `War room · ${war.title} · ${elapsed}` : `${war.count} war rooms`,
      detail:
        war.count === 1
          ? `War room open for ${elapsed} on "${war.title}"`
          : `${war.count} war rooms are open; the oldest is "${war.title}" (${elapsed})`,
      href: war.count === 1 ? `/incidents/${war.incidentId}` : '/incidents',
      tone: 'critical',
      icon: 'warRoom',
      priority: 2,
    });
  }
  const page = health.statusPage;
  if (page)
    out.push({
      key: 'statusPage',
      label: `Status page: ${SEVERITY_LABEL[page.status]}${page.more > 0 ? ` +${page.more}` : ''}`,
      detail: `${page.pageName} reports ${SEVERITY_LABEL[page.status].toLowerCase()}${page.more > 0 ? `; ${page.more} more status ${page.more === 1 ? 'page is' : 'pages are'} not operational` : ''}`,
      href: page.href,
      tone: page.status === 'DEGRADED' ? 'elevated' : 'critical',
      icon: 'statusPage',
      priority: 4,
    });
  if (health.runbooksRunning > 0)
    out.push({
      key: 'runbooks',
      label: `${plural(health.runbooksRunning, 'runbook', 'runbooks')} running`,
      detail: `${plural(health.runbooksRunning, 'runbook execution is', 'runbook executions are')} in progress`,
      href: '/runbooks/executions',
      tone: 'info',
      icon: 'runbook',
      priority: 7,
    });
  if (health.ingestionDelayed)
    out.push({
      key: 'ingestion',
      label: 'Ingestion delayed',
      detail: 'Alert ingestion is backing up: the oldest pending event has waited over 5 minutes',
      href: '/settings/system/health',
      tone: 'critical',
      icon: 'ingestion',
      priority: 3,
    });
  return out;
}

/** The `max` highest-priority signals stay inline (in display order); the rest overflow. */
export function splitSignals(signals: Signal[], max: number) {
  const keep = new Set(
    [...signals]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, max)
      .map(signal => signal.key)
  );
  return {
    inline: signals.filter(signal => keep.has(signal.key)),
    overflow: signals.filter(signal => !keep.has(signal.key)),
  };
}

export const AWAITING_ACK_HREF = '/incidents?status=OPEN';
export const SLA_AT_RISK_HREF = '/?view=breaching';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function awaitingAckLabel(count: number) {
  return `${count} awaiting ack`;
}

export function awaitingAckDetail(count: number) {
  return `${plural(count, 'incident is', 'incidents are')} open and unacknowledged`;
}

export function slaAtRiskLabel(count: number) {
  return `${count} SLA at risk`;
}

export function slaAtRiskDetail(count: number) {
  return `${plural(count, 'incident is', 'incidents are')} close to or just past an ack or resolve SLA deadline`;
}

export function maintenanceLabel(m: ActiveMaintenance) {
  return m.count === 1 ? `${m.serviceName} in maintenance` : `${m.count} services in maintenance`;
}

export function maintenanceHref(m: ActiveMaintenance) {
  return m.count === 1 ? `/services/${m.serviceId}` : '/services';
}

export function maintenanceDetail(m: ActiveMaintenance, timeZone: string) {
  return `${maintenanceLabel(m)}, ends ${formatDayTime(Date.parse(m.endsAt), timeZone)}`;
}

export type OnCallState =
  | { kind: 'on'; scheduleId: string; scheduleName: string; until: string | null }
  | { kind: 'off'; scheduleId: string; scheduleName: string; next: string };

export type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'offline';

export const MY_INCIDENTS_HREF = '/incidents?filter=mine';

const time = createDateTimeFormatterCache('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekday = createDateTimeFormatterCache('en-GB', { weekday: 'short' });
const calendarDay = createDateTimeFormatterCache('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `HH:mm` in the given zone. */
function formatClock(at: Date | number, timeZone: string) {
  return time(timeZone).format(at);
}

/** `Ddd HH:mm` in the given zone. */
export function formatDayTime(at: Date | number, timeZone: string) {
  return `${weekday(timeZone).format(at)} ${formatClock(at, timeZone)}`;
}

/** `HH:mm` when `at` falls on the same calendar day as `now` in the zone, else `Ddd HH:mm`. */
export function formatShiftTime(at: Date | number, now: Date | number, timeZone: string) {
  const day = calendarDay(timeZone);
  return day.format(at) === day.format(now)
    ? formatClock(at, timeZone)
    : formatDayTime(at, timeZone);
}

/** The viewer's on-call state at `now`: the current shift ending first, else the next to start. */
export function deriveOnCall(shifts: readonly StatusBarShift[], now: number): OnCallState | null {
  const current = shifts
    .filter(shift => Date.parse(shift.start) <= now && Date.parse(shift.end) > now)
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))[0];
  if (current)
    return {
      kind: 'on',
      scheduleId: current.scheduleId,
      scheduleName: current.scheduleName,
      until: current.endClamped ? null : current.end,
    };
  const next = shifts
    .filter(shift => Date.parse(shift.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  return next
    ? {
        kind: 'off',
        scheduleId: next.scheduleId,
        scheduleName: next.scheduleName,
        next: next.start,
      }
    : null;
}

/** When the on-call state next changes (a shift starts or really ends), or null. */
export function nextOnCallChange(shifts: readonly StatusBarShift[], now: number): number | null {
  const moments = shifts.flatMap(shift => [
    Date.parse(shift.start),
    ...(shift.endClamped ? [] : [Date.parse(shift.end)]),
  ]);
  const future = moments.filter(at => at > now);
  return future.length ? Math.min(...future) : null;
}

export function onCallLabel(state: OnCallState, now: number, timeZone: string) {
  if (state.kind === 'on')
    return state.until
      ? `On call · ${state.scheduleName} · until ${formatShiftTime(Date.parse(state.until), now, timeZone)}`
      : `On call · ${state.scheduleName}`;
  return `Off call · next ${formatDayTime(Date.parse(state.next), timeZone)}`;
}

/** `{n} assigned · {m} unacked`, or null when there is nothing to show. */
export function myWorkLabel(counts: MyIncidentCounts) {
  if (counts.assigned === 0 && counts.unacked === 0) return null;
  return `${counts.assigned} assigned · ${counts.unacked} unacked`;
}

export function connectionState(input: {
  available: boolean;
  isConnected: boolean;
  isRevoked: boolean;
  online: boolean;
  everConnected: boolean;
}): ConnectionState {
  if (input.available && input.isConnected) return 'live';
  if (!input.available || input.isRevoked || !input.online) return 'offline';
  return input.everConnected ? 'reconnecting' : 'connecting';
}

export function connectionLabel(state: ConnectionState) {
  switch (state) {
    case 'live':
      return 'Live';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'offline':
      return 'Offline';
  }
}
