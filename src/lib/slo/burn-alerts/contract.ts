import { z } from 'zod/v3';

/**
 * SLO burn-rate alerting: the shared contract (no server imports, so client components can use it).
 *
 * A policy measures one availability or uptime objective from two metric queries, good events and total
 * events, each returning a count per 5-minute step. Burn = (1 − Σgood/Σtotal) / (1 − target). The tiers are
 * the multi-window alerts from the Google SRE workbook: a tier fires only when both its long and its short
 * window burn at or above its threshold, so a past spike that has stopped does not keep alerting.
 */

export const SLO_ALERT_STATES = ['OK', 'TICKET', 'PAGE'] as const;
export type SloAlertState = (typeof SLO_ALERT_STATES)[number];
/** OK < TICKET < PAGE. */
export const sloAlertRank = (state: SloAlertState) => SLO_ALERT_STATES.indexOf(state);

/** Window lengths in minutes. */
export const SLO_BURN_WINDOWS = {
  '5m': 5,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '6h': 360,
  '1d': 1440,
  '3d': 4320,
} as const;
export type SloBurnWindow = keyof typeof SLO_BURN_WINDOWS;
export type SloBurnByWindow = Record<SloBurnWindow, number | null>;

export interface SloBurnTier {
  tier: Exclude<SloAlertState, 'OK'>;
  long: SloBurnWindow;
  short: SloBurnWindow;
  threshold: number;
}

export const SLO_BURN_TIERS: readonly SloBurnTier[] = [
  { tier: 'PAGE', long: '1h', short: '5m', threshold: 14.4 },
  { tier: 'PAGE', long: '6h', short: '30m', threshold: 6 },
  { tier: 'TICKET', long: '1d', short: '2h', threshold: 3 },
  { tier: 'TICKET', long: '3d', short: '6h', threshold: 1 },
];

export const SLO_ALERT_BOUNDS = {
  stepSeconds: 300,
  retentionDays: 30,
  /** The longest window: what a first evaluation backfills, and all an evaluation ever needs to read. */
  maxWindowMinutes: SLO_BURN_WINDOWS['3d'],
  /** Clean evaluations in a row before the state steps down. */
  deEscalateAfter: 3,
  /** A step is read only once it is this old, so late scrapes are counted. */
  settleSeconds: 60,
  scheduleBatch: 50,
  scheduleCheckIntervalMs: 60_000,
  evaluationBudgetMs: 60_000,
  maxQueryLength: 2000,
  maxSeries: 200,
  historyDefaultHours: 24,
  historyMaxHours: 168,
  maxTransitions: 50,
} as const;

/** Objectives a policy can measure: the percentage ones, where 1 − target is an error budget. */
export const SLO_ALERTABLE_METRICS = ['UPTIME', 'AVAILABILITY'] as const;

export const SLO_ALERT_STATUS = {
  OK: 'OK',
  NO_DATA: 'NO_DATA',
  NO_CONNECTION: 'NO_CONNECTION',
  CONNECTION_DISABLED: 'CONNECTION_DISABLED',
  CONNECTION_NOT_ALLOWED: 'CONNECTION_NOT_ALLOWED',
  UNSUPPORTED: 'UNSUPPORTED',
  CONNECTOR_ERROR: 'CONNECTOR_ERROR',
  OBJECTIVE_INACTIVE: 'OBJECTIVE_INACTIVE',
  DISABLED: 'DISABLED',
  EVENT_FAILED: 'EVENT_FAILED',
} as const;

export const sloAlertPolicyInputSchema = z
  .object({
    connectionId: z.string().trim().min(1).max(64),
    goodQuery: z.string().trim().min(1).max(SLO_ALERT_BOUNDS.maxQueryLength),
    totalQuery: z.string().trim().min(1).max(SLO_ALERT_BOUNDS.maxQueryLength),
    enabled: z.boolean().default(false),
    ticketsEnabled: z.boolean().default(true),
  })
  .strict();
export type SloAlertPolicyInput = z.infer<typeof sloAlertPolicyInputSchema>;

export interface SloAlertPolicyView {
  objectiveId: string;
  serviceId: string;
  connectionId: string | null;
  connectionName: string | null;
  goodQuery: string;
  totalQuery: string;
  stepSeconds: number;
  enabled: boolean;
  ticketsEnabled: boolean;
  state: SloAlertState;
  stateSince: string;
  lastEvaluatedAt: string | null;
  lastStatus: string | null;
  lastIncidentId: string | null;
  coverageFrom: string | null;
  updatedAt: string;
}

export interface SloBurnHistoryPoint {
  at: string;
  good: number;
  total: number;
  /** Good / total as a percentage; null for a step with no events. */
  sli: number | null;
  /** Burn over the hour ending at this step; null while the hour has no events. */
  burn1h: number | null;
}

export interface SloAlertTransitionView {
  from: SloAlertState;
  to: SloAlertState;
  at: string;
  incidentId: string | null;
  burnByWindow: SloBurnByWindow;
}

export interface SloBurnHistory {
  objectiveId: string;
  targetPercent: number;
  state: SloAlertState;
  hours: number;
  points: SloBurnHistoryPoint[];
  transitions: SloAlertTransitionView[];
  tiers: readonly SloBurnTier[];
}

export const isSloAlertState = (value: unknown): value is SloAlertState =>
  typeof value === 'string' && (SLO_ALERT_STATES as readonly string[]).includes(value);
