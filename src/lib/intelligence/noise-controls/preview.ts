import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { withDbBudget } from '../jobs/db-budget';
import { parseOrThrow, type IntelligenceSettingsView } from '../settings/service';
import { shiftIntoReplayRange } from './builders';
import { compileSuppressionRule } from './cache';
import {
  DEFAULT_NOISE_CONTROL_DEFINITION,
  maintenanceWindowInputSchema,
  matcherSchema,
  orchestrationRuleSchema,
  PREPAGING_LIMITS,
  suppressionRuleInputSchema,
  type PrePagingInput,
} from './contract';
import type { CompiledWindow } from './evaluate';
import { compileMatcher, matchesAll } from './matchers';
import { validateWindowTiming } from './recurrence';
import { simulatePrePagingControls, type SimulationOutcome } from './simulation';

/**
 * Read-only previews for the noise-control builders. Nothing here writes a control: saving still goes
 * through `manage.ts` and its server actions. Every query is bounded by a time window, a row limit and
 * the lane's DB budget, and is served by `Alert(createdAt)` / `Alert(serviceId, createdAt)`.
 */

export const PREVIEW_DAYS = 7;
export const MATCH_PREVIEW_LIMIT = 2_000;

export interface MatchPreviewExample {
  incidentId: string;
  summary: string;
  source: string;
  severity: string | null;
  at: Date;
}

export interface MatchPreview {
  days: number;
  alertsScanned: number;
  matchedAlerts: number;
  matchedIncidents: number;
  /** More alerts exist in the window than were scanned; counts cover the most recent ones. */
  truncated: boolean;
  examples: MatchPreviewExample[];
}

const matchPreviewSchema = z
  .object({
    matchers: z.array(matcherSchema).min(1).max(PREPAGING_LIMITS.maxMatchers),
    serviceId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable()
      .optional(),
  })
  .strict();

type AlertRow = {
  incidentId: string;
  serviceId: string;
  severity: string | null;
  resourceKey: string | null;
  fingerprintHash: string | null;
  dedupKey: string | null;
  labels: unknown;
  payload: unknown;
  createdAt: Date;
};

function stringLabels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function toInput(row: AlertRow): PrePagingInput {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    serviceId: row.serviceId,
    source: typeof payload.source === 'string' ? payload.source : 'unknown',
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    severity: row.severity,
    urgency: 'MEDIUM',
    labels: stringLabels(row.labels),
    resourceKey: row.resourceKey,
    fingerprintHash: row.fingerprintHash,
    dedupKey: row.dedupKey ?? '',
    receivedAt: row.createdAt,
  };
}

/**
 * The live "what would this match" count behind the suppression-rule builder: the most recent alerts of
 * the last week (at most 2,000), matched in memory with the same matcher code the hook uses.
 */
export async function previewMatchers(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  input: unknown,
  now: Date = new Date()
): Promise<MatchPreview> {
  const parsed = parseOrThrow(matchPreviewSchema, input);
  const compiled = parsed.matchers.map(compileMatcher);
  const since = new Date(now.getTime() - PREVIEW_DAYS * 86_400_000);
  const rows = await withDbBudget(
    { maxDbMs: Math.max(settings.maxDbMs, 5_000) },
    tx =>
      tx.$queryRaw<AlertRow[]>`
        SELECT a."incidentId", a."serviceId", a."severity", a."resourceKey", a."fingerprintHash",
               a."dedupKey", a."labels", a."payload", a."createdAt"
        FROM "Alert" a
        WHERE a."createdAt" >= ${since} AND a."createdAt" <= ${now}
          ${parsed.serviceId ? Prisma.sql`AND a."serviceId" = ${parsed.serviceId}` : Prisma.empty}
        ORDER BY a."createdAt" DESC
        LIMIT ${MATCH_PREVIEW_LIMIT + 1}`
  );
  const truncated = rows.length > MATCH_PREVIEW_LIMIT;
  const scanned = rows.slice(0, MATCH_PREVIEW_LIMIT);
  const incidents = new Set<string>();
  const examples: MatchPreviewExample[] = [];
  let matchedAlerts = 0;
  for (const row of scanned) {
    const alert = toInput(row);
    if (!matchesAll(compiled, alert)) continue;
    matchedAlerts += 1;
    if (!incidents.has(row.incidentId) && examples.length < 5)
      examples.push({
        incidentId: row.incidentId,
        summary: alert.summary.slice(0, 140),
        source: alert.source.slice(0, 64),
        severity: row.severity,
        at: row.createdAt,
      });
    incidents.add(row.incidentId);
  }
  return {
    days: PREVIEW_DAYS,
    alertsScanned: scanned.length,
    matchedAlerts,
    matchedIncidents: incidents.size,
    truncated,
    examples,
  };
}

export interface WindowPreview {
  outcome: SimulationOutcome;
  /** Whole weeks the window was moved back to land in the replayed week; 0 when it already did. */
  shiftedWeeks: number;
  replayedFrom: Date;
  replayedTo: Date;
}

/**
 * "Test this window against the last 7 days": the unsaved window alone (no other controls), replayed
 * over the last week. A future window is replayed at the same weekday and time one or more weeks back.
 */
export async function previewMaintenanceWindow(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  input: unknown,
  createdById: string | null,
  now: Date = new Date()
): Promise<WindowPreview> {
  const parsed = parseOrThrow(maintenanceWindowInputSchema, input);
  const startsAt = new Date(parsed.startsAt);
  const endsAt = new Date(parsed.endsAt);
  try {
    validateWindowTiming(startsAt, endsAt, parsed.recurrence ?? null, now);
  } catch (error) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'recurrence', message: (error as Error).message }],
    });
  }
  const shifted = shiftIntoReplayRange(startsAt, endsAt, now);
  const window: CompiledWindow = {
    id: 'preview-window',
    name: parsed.name,
    scope: parsed.scope,
    serviceId: parsed.scope === 'SERVICE' ? (parsed.serviceId ?? null) : null,
    teamId: parsed.scope === 'TEAM' ? (parsed.teamId ?? null) : null,
    labelKey: parsed.scope === 'LABEL' ? (parsed.labelKey?.toLowerCase() ?? null) : null,
    labelValue: parsed.scope === 'LABEL' ? (parsed.labelValue ?? null) : null,
    startsAt: shifted.startsAt,
    endsAt: shifted.endsAt,
    recurrence: parsed.recurrence ?? null,
    effect: parsed.effect,
    downgradeUrgency: parsed.effect === 'DOWNGRADE' ? (parsed.downgradeUrgency ?? null) : null,
    endedAt: null,
  };
  const serviceTeams = new Map<string, string | null>();
  if (window.teamId) {
    const services = await prisma.service.findMany({
      where: { teamId: window.teamId },
      select: { id: true, teamId: true },
      take: 10_000,
    });
    for (const service of services) serviceTeams.set(service.id, service.teamId);
  }
  const outcome = await simulatePrePagingControls(settings, {
    serviceId: window.serviceId,
    days: PREVIEW_DAYS,
    createdById,
    now,
    candidate: { windows: [window], serviceTeams, isolate: true },
  });
  return {
    outcome,
    shiftedWeeks: shifted.shiftedWeeks,
    replayedFrom: new Date(now.getTime() - PREVIEW_DAYS * 86_400_000),
    replayedTo: now,
  };
}

/** "Test this rule against the last 7 days": the unsaved suppression rule alone. */
export async function previewSuppressionRule(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  input: unknown,
  createdById: string | null,
  now: Date = new Date()
): Promise<SimulationOutcome> {
  const parsed = parseOrThrow(suppressionRuleInputSchema, input);
  const rule = compileSuppressionRule({
    id: 'preview-rule',
    name: parsed.name,
    serviceId: parsed.serviceId ?? null,
    matchers: parsed.matchers,
    effect: parsed.effect,
    downgradeUrgency: parsed.effect === 'DOWNGRADE' ? (parsed.downgradeUrgency ?? null) : null,
    // Replay the past as if the rule had been live; its expiry only matters from now on.
    expiresAt: null,
  });
  if (!rule)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'matchers', message: 'Conditions do not compile' }],
    });
  return simulatePrePagingControls(settings, {
    serviceId: parsed.serviceId ?? null,
    days: PREVIEW_DAYS,
    createdById,
    now,
    candidate: { rules: [rule], isolate: true },
  });
}

const orchestrationPreviewSchema = z
  .object({
    rules: z.array(orchestrationRuleSchema).min(1).max(PREPAGING_LIMITS.maxOrchestrationRules),
    serviceId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable()
      .optional(),
  })
  .strict();

/**
 * Per-rule replay for the orchestration builder: the rules, in their order, with every other control
 * off. `matchedRules` counts incidents each rule matched; `bySource` counts the decisive (drop or
 * suppress) hits.
 */
export async function previewOrchestrationRules(
  settings: Pick<IntelligenceSettingsView, 'maxDbMs'>,
  input: unknown,
  createdById: string | null,
  now: Date = new Date()
): Promise<SimulationOutcome> {
  const parsed = parseOrThrow(orchestrationPreviewSchema, input);
  return simulatePrePagingControls(settings, {
    serviceId: parsed.serviceId ?? null,
    days: PREVIEW_DAYS,
    createdById,
    now,
    candidate: {
      definition: {
        ...DEFAULT_NOISE_CONTROL_DEFINITION,
        orchestration: { rules: parsed.rules },
      },
      isolate: true,
    },
  });
}
