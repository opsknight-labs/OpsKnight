import { isWindowActiveAt } from '@/lib/intelligence/noise-controls/recurrence';
import type { FieldState, IntelligenceFieldKey } from '../contract';

/** How long each time-stamped signal stays true after it happened. */
export const INTELLIGENCE_SIGNALS = {
  riskyChangeMinutes: 60,
  /** ChangeEvent.riskScore (0..1) at or above this counts as risky. */
  riskThreshold: 0.7,
  flappingMinutes: 15,
  stormMinutes: 15,
} as const;

/**
 * Per-service evidence precomputed off the hot path (the 30 s snapshot, or one bounded read per replay).
 * Arrays hold epoch milliseconds; `slo` holds each objective's snapshots (live: only the latest).
 */
export interface ServiceSignals {
  riskyChangeAt: readonly number[];
  flappingAt: readonly number[];
  stormAt: readonly number[];
  slo: ReadonlyArray<{ objectiveId: string; endAt: number; breached: boolean }>;
}

export const EMPTY_SIGNALS: ServiceSignals = {
  riskyChangeAt: [],
  flappingAt: [],
  stormAt: [],
  slo: [],
};

/** The window fields `inMaintenance` needs; LABEL-scoped windows depend on the alert and are ignored. */
export interface SignalWindow {
  scope: 'SERVICE' | 'TEAM' | 'LABEL' | 'ALL';
  serviceId: string | null;
  teamId: string | null;
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  endedAt: Date | null;
}

const MISSING: FieldState = { state: 'MISSING' };
const bool = (value: boolean): FieldState => ({ state: 'RECOGNIZED', value });
const within = (times: readonly number[], at: number, minutes: number) =>
  times.some(time => time <= at && time > at - minutes * 60_000);

export function inMaintenanceAt(
  windows: readonly SignalWindow[],
  service: { serviceId: string; teamId: string | null },
  at: Date
): boolean {
  return windows.some(
    window =>
      (window.scope === 'ALL' ||
        (window.scope === 'SERVICE' && window.serviceId === service.serviceId) ||
        (window.scope === 'TEAM' && !!service.teamId && window.teamId === service.teamId)) &&
      !(window.endedAt && window.endedAt.getTime() <= at.getTime()) &&
      isWindowActiveAt(window, at)
  );
}

/** Latest snapshot per objective at `at`: any breached → true, all met → false, none → unknown. */
function sloBurningAt(slo: ServiceSignals['slo'], at: number): boolean | null {
  const latest = new Map<string, { endAt: number; breached: boolean }>();
  for (const row of slo) {
    if (row.endAt > at) continue;
    const seen = latest.get(row.objectiveId);
    if (!seen || row.endAt > seen.endAt) latest.set(row.objectiveId, row);
  }
  if (!latest.size) return null;
  return [...latest.values()].some(row => row.breached);
}

/**
 * The intelligence part of the automation context. `signals: null` means the snapshot is cold: every
 * field is MISSING, so comparisons on it are FALSE/UNKNOWN and no rule matches on a guess.
 */
export function intelligenceContext(input: {
  signals: ServiceSignals | null;
  inMaintenance: boolean | null;
  at: Date;
}): Record<IntelligenceFieldKey, FieldState> {
  const { signals } = input;
  if (!signals)
    return {
      inMaintenance: MISSING,
      recentRiskyChange: MISSING,
      sloBurning: MISSING,
      flapping: MISSING,
      stormActive: MISSING,
    };
  const at = input.at.getTime();
  const slo = sloBurningAt(signals.slo, at);
  return {
    inMaintenance: input.inMaintenance === null ? MISSING : bool(input.inMaintenance),
    recentRiskyChange: bool(
      within(signals.riskyChangeAt, at, INTELLIGENCE_SIGNALS.riskyChangeMinutes)
    ),
    sloBurning: slo === null ? MISSING : bool(slo),
    flapping: bool(within(signals.flappingAt, at, INTELLIGENCE_SIGNALS.flappingMinutes)),
    stormActive: bool(within(signals.stormAt, at, INTELLIGENCE_SIGNALS.stormMinutes)),
  };
}
