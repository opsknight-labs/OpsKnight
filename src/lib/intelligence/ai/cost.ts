import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { parseOrThrow, type IntelligenceActor } from '../settings/service';
import { AI_CAPABILITIES } from './port';
import { utcDay } from './budget';
import {
  BUDGET_ALERT_THRESHOLDS,
  PROVIDER_KINDS,
  budgetKey,
  budgetUtilization,
  resolveModelPrice,
  usdToMicros,
  type BudgetScope,
  type ModelPriceOverride,
  type ProviderKind,
  type ResolvedModelPrice,
} from './pricing';

/**
 * AI cost governance: administrator price overrides, optional per-team and per-capability daily budgets,
 * spend attribution and the read models behind the usage page and the budget metrics. Enforcement itself
 * lives in budget.ts (inside the day-locked reservation), so this module never decides admission.
 */

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

// ---------- Prices ----------

const PRICE_CACHE_MS = 30_000;
let priceCache: { rows: ModelPriceOverride[]; expiresAt: number } | null = null;

export function invalidatePriceCache(): void {
  priceCache = null;
}

export async function listModelPriceOverrides(): Promise<ModelPriceOverride[]> {
  const rows = await prisma.aiModelPrice.findMany({
    orderBy: [{ providerKind: 'asc' }, { model: 'asc' }],
    take: 500,
    select: { providerKind: true, model: true, inputUsdPerMTok: true, outputUsdPerMTok: true },
  });
  return rows.map(row => ({ ...row, providerKind: row.providerKind as ProviderKind }));
}

async function cachedOverrides(now = Date.now()): Promise<ModelPriceOverride[]> {
  if (priceCache && priceCache.expiresAt > now) return priceCache.rows;
  try {
    const rows = await listModelPriceOverrides();
    priceCache = { rows, expiresAt: now + PRICE_CACHE_MS };
    return rows;
  } catch (error) {
    // Prices only shape accounting and dollar estimates; token budgets still apply. Fall back to the
    // last known overrides (or the built-in table) rather than failing a request on a price read.
    logger.warn('[AI] Could not load model price overrides', {
      error: error instanceof Error ? error.message : String(error),
    });
    return priceCache?.rows ?? [];
  }
}

export async function priceForModel(
  kind: string,
  model: string | null | undefined
): Promise<ResolvedModelPrice | null> {
  if (!model || !(PROVIDER_KINDS as readonly string[]).includes(kind)) return null;
  return resolveModelPrice(kind as ProviderKind, model, await cachedOverrides());
}

const priceInputSchema = z.object({
  providerKind: z.enum(PROVIDER_KINDS),
  model: z.string().trim().min(1).max(200),
  inputUsdPerMTok: z.number().finite().min(0).max(100_000),
  outputUsdPerMTok: z.number().finite().min(0).max(100_000),
});

/** Caller must authorize INTELLIGENCE_MANAGE. Upserts one override and audits old and new values. */
export async function saveModelPrice(input: unknown, actor: IntelligenceActor): Promise<void> {
  const value = parseOrThrow(priceInputSchema, input);
  await prisma.$transaction(async tx => {
    const where = {
      providerKind_model: { providerKind: value.providerKind, model: value.model },
    } as const;
    const previous = await tx.aiModelPrice.findUnique({ where });
    const saved = await tx.aiModelPrice.upsert({
      where,
      create: { ...value, updatedBy: actor.actorId },
      update: {
        inputUsdPerMTok: value.inputUsdPerMTok,
        outputUsdPerMTok: value.outputUsdPerMTok,
        updatedBy: actor.actorId,
      },
    });
    await logAudit(
      {
        action: 'intelligence.ai.price.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'ai',
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: previous
          ? {
              providerKind: previous.providerKind,
              model: previous.model,
              inputUsdPerMTok: previous.inputUsdPerMTok,
              outputUsdPerMTok: previous.outputUsdPerMTok,
            }
          : undefined,
        newValue: {
          providerKind: saved.providerKind,
          model: saved.model,
          inputUsdPerMTok: saved.inputUsdPerMTok,
          outputUsdPerMTok: saved.outputUsdPerMTok,
        },
      },
      tx
    );
  });
  invalidatePriceCache();
}

export async function deleteModelPrice(
  providerKind: string,
  model: string,
  actor: IntelligenceActor
): Promise<boolean> {
  const value = parseOrThrow(priceInputSchema.pick({ providerKind: true, model: true }), {
    providerKind,
    model,
  });
  const deleted = await prisma.$transaction(async tx => {
    const removed = await tx.aiModelPrice.deleteMany({ where: value });
    if (removed.count)
      await logAudit(
        {
          action: 'intelligence.ai.price.deleted',
          entityType: 'SYSTEM_CONFIG',
          entityId: 'ai',
          actorId: actor.actorId,
          ...auditSource(actor),
          oldValue: value,
        },
        tx
      );
    return removed.count > 0;
  });
  invalidatePriceCache();
  return deleted;
}

// ---------- Attribution ----------

/**
 * One team per call, so team spend adds up to the total: the incident's owning team when the request is
 * about an incident, otherwise the person's earliest team membership; none for system actors.
 */
export async function attributeTeam(
  actorId: string,
  incidentId?: string | null
): Promise<string | null> {
  if (incidentId) {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { teamId: true },
    });
    if (incident?.teamId) return incident.teamId;
  }
  if (actorId.includes(':')) return null;
  const membership = await prisma.teamMember.findFirst({
    where: { userId: actorId },
    orderBy: [{ createdAt: 'asc' }, { teamId: 'asc' }],
    select: { teamId: true },
  });
  return membership?.teamId ?? null;
}

// ---------- Budgets ----------

export interface AiBudgetView {
  id: string;
  key: string;
  scope: BudgetScope;
  teamId: string | null;
  capability: string | null;
  /** Team name, or null when the team no longer exists (the budget then never matches). */
  label: string;
  dailyTokenLimit: number | null;
  dailyCostLimitMicros: number | null;
  enabled: boolean;
  revision: number;
}

const budgetInputSchema = z
  .object({
    scope: z.enum(['TEAM', 'CAPABILITY']),
    teamId: z.string().trim().min(1).max(64).optional(),
    capability: z.enum(AI_CAPABILITIES).optional(),
    dailyTokenLimit: z.number().int().min(0).max(1_000_000_000).nullable(),
    dailyCostLimitUsd: z.number().finite().min(0).max(1_000_000).nullable(),
    enabled: z.boolean(),
    /** 0 when creating; the current revision when editing. */
    expectedRevision: z.number().int().min(0),
  })
  .refine(value => (value.scope === 'TEAM' ? Boolean(value.teamId) : Boolean(value.capability)), {
    message: 'Choose a team or a capability',
    path: ['subject'],
  })
  .refine(value => value.dailyTokenLimit !== null || value.dailyCostLimitUsd !== null, {
    message: 'Set a token limit, a dollar limit or both',
    path: ['limit'],
  });

const BUDGET_SELECT = {
  id: true,
  key: true,
  scope: true,
  teamId: true,
  capability: true,
  dailyTokenLimit: true,
  dailyCostLimitMicros: true,
  enabled: true,
  revision: true,
} as const;

type BudgetRow = Prisma.AiBudgetGetPayload<{ select: typeof BUDGET_SELECT }>;

const plainBudget = (row: BudgetRow) => ({
  ...row,
  dailyCostLimitMicros: row.dailyCostLimitMicros === null ? null : Number(row.dailyCostLimitMicros),
});

export const MAX_AI_BUDGETS = 200;

export async function listBudgets(): Promise<AiBudgetView[]> {
  const rows = await prisma.aiBudget.findMany({
    select: BUDGET_SELECT,
    orderBy: [{ scope: 'asc' }, { key: 'asc' }],
    take: MAX_AI_BUDGETS,
  });
  const teamIds = rows.flatMap(row => (row.teamId ? [row.teamId] : []));
  const teams = teamIds.length
    ? await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(teams.map(team => [team.id, team.name]));
  return rows.map(row => ({
    ...plainBudget(row),
    scope: row.scope as BudgetScope,
    label:
      row.scope === 'TEAM'
        ? (names.get(row.teamId ?? '') ?? 'Deleted team')
        : (row.capability ?? 'Unknown'),
  }));
}

/**
 * Caller must authorize INTELLIGENCE_MANAGE. Creates or edits the budget for one team or capability with a
 * revision compare-and-set (0 = must not exist yet), and audits old and new values in the same transaction.
 */
export async function saveBudget(input: unknown, actor: IntelligenceActor): Promise<AiBudgetView> {
  const value = parseOrThrow(budgetInputSchema, input);
  const scope = value.scope as BudgetScope;
  const subject = scope === 'TEAM' ? value.teamId! : value.capability!;
  const key = budgetKey(scope, subject);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-budget-config:${key}`}, 0))`;
    if (scope === 'TEAM') {
      const team = await tx.team.findUnique({ where: { id: subject }, select: { id: true } });
      if (!team)
        throw new AppError({
          code: 'VALIDATION_FAILED',
          fields: [{ field: 'teamId', code: 'not_found', message: 'Team not found' }],
        });
    }
    const previous = await tx.aiBudget.findUnique({ where: { key }, select: BUDGET_SELECT });
    if ((previous?.revision ?? 0) !== value.expectedRevision)
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    if (!previous && (await tx.aiBudget.count()) >= MAX_AI_BUDGETS)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'scope', code: 'too_many', message: 'Too many budgets' }],
      });
    const data = {
      dailyTokenLimit: value.dailyTokenLimit,
      dailyCostLimitMicros:
        value.dailyCostLimitUsd === null ? null : BigInt(usdToMicros(value.dailyCostLimitUsd)),
      enabled: value.enabled,
      updatedBy: actor.actorId,
    };
    const saved = previous
      ? await tx.aiBudget.update({
          where: { key },
          data: { ...data, revision: { increment: 1 } },
          select: BUDGET_SELECT,
        })
      : await tx.aiBudget.create({
          data: {
            ...data,
            key,
            scope,
            teamId: scope === 'TEAM' ? subject : null,
            capability: scope === 'CAPABILITY' ? subject : null,
          },
          select: BUDGET_SELECT,
        });
    await logAudit(
      {
        action: 'intelligence.ai.budget.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'ai',
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: previous ? plainBudget(previous) : undefined,
        newValue: plainBudget(saved),
      },
      tx
    );
    return { ...plainBudget(saved), scope, label: subject };
  });
}

export async function deleteBudget(
  id: string,
  expectedRevision: number,
  actor: IntelligenceActor
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const previous = await tx.aiBudget.findUnique({ where: { id }, select: BUDGET_SELECT });
    if (!previous) return false;
    if (previous.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    await tx.aiBudget.delete({ where: { id } });
    await logAudit(
      {
        action: 'intelligence.ai.budget.deleted',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'ai',
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: plainBudget(previous),
      },
      tx
    );
    return true;
  });
}

export interface BudgetStatus {
  key: string;
  scope: BudgetScope | 'GLOBAL';
  label: string;
  tokens: number;
  costMicros: number;
  dailyTokenLimit: number | null;
  dailyCostLimitMicros: number | null;
  utilization: number;
}

/** Today's consumption (settled plus live holds) against every enabled budget and the global token budget. */
export async function getBudgetStatuses(
  globalTokenBudget: number,
  now: Date = new Date(),
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<BudgetStatus[]> {
  const day = utcDay(now);
  const budgets = await client.aiBudget.findMany({
    where: { enabled: true },
    select: BUDGET_SELECT,
    take: MAX_AI_BUDGETS,
  });
  const [usage, held, settledRows] = await Promise.all([
    client.aiUsageDay.findUnique({ where: { day } }),
    client.$queryRaw<
      Array<{ teamId: string | null; capability: string | null; tokens: bigint; cost: bigint }>
    >(Prisma.sql`
      SELECT "teamId", capability, coalesce(sum(tokens),0)::bigint AS tokens,
        coalesce(sum("costMicros"),0)::bigint AS cost
      FROM "AiTokenReservation"
      WHERE day = ${day} AND "settledAt" IS NULL AND "expiresAt" > ${now}
      GROUP BY "teamId", capability`),
    client.$queryRaw<
      Array<{ teamId: string; capability: string; tokens: bigint; cost: bigint }>
    >(Prisma.sql`
      SELECT "teamId", capability, sum("inputTokens" + "outputTokens")::bigint AS tokens,
        sum("costMicros")::bigint AS cost
      FROM "AiUsageBreakdownDay" WHERE day = ${day}
      GROUP BY "teamId", capability`),
  ]);
  const sum = (
    rows: Array<{ teamId: string | null; capability: string | null; tokens: bigint; cost: bigint }>,
    match: (row: { teamId: string | null; capability: string | null }) => boolean
  ) =>
    rows.filter(match).reduce(
      (total, row) => ({
        tokens: total.tokens + Number(row.tokens),
        costMicros: total.costMicros + Number(row.cost),
      }),
      { tokens: 0, costMicros: 0 }
    );
  const heldTotal = sum(held, () => true);
  const statuses: BudgetStatus[] = [];
  const globalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + heldTotal.tokens;
  statuses.push({
    key: 'global',
    scope: 'GLOBAL',
    label: 'All AI usage',
    tokens: globalTokens,
    costMicros: Number(usage?.costMicros ?? 0) + heldTotal.costMicros,
    dailyTokenLimit: globalTokenBudget,
    dailyCostLimitMicros: null,
    utilization: budgetUtilization(
      { dailyTokenLimit: globalTokenBudget, dailyCostLimitMicros: null },
      { tokens: globalTokens, costMicros: 0 }
    ),
  });
  for (const row of budgets) {
    const isTeam = row.scope === 'TEAM';
    const match = (candidate: { teamId: string | null; capability: string | null }) =>
      isTeam ? candidate.teamId === row.teamId : candidate.capability === row.capability;
    const settled = sum(settledRows, match);
    const live = sum(held, match);
    const current = {
      tokens: settled.tokens + live.tokens,
      costMicros: settled.costMicros + live.costMicros,
    };
    const limits = plainBudget(row);
    statuses.push({
      key: row.key,
      scope: row.scope as BudgetScope,
      label: (isTeam ? row.teamId : row.capability) ?? row.key,
      ...current,
      dailyTokenLimit: limits.dailyTokenLimit,
      dailyCostLimitMicros: limits.dailyCostLimitMicros,
      utilization: budgetUtilization(limits, current),
    });
  }
  return statuses;
}

export type BudgetMetricSample =
  | { name: 'opsknight_intelligence_ai_spend_today_usd'; value: number; labels?: undefined }
  | {
      name: 'opsknight_intelligence_ai_budget_utilization_max_ratio';
      value: number;
      labels: { scope: string };
    }
  | {
      name: 'opsknight_intelligence_ai_budgets_over_threshold';
      value: number;
      labels: { scope: string; threshold: string };
    };

/** Bounded series only: per-scope maxima and counts, never a team or budget identifier. */
export function budgetMetricSamples(
  statuses: readonly BudgetStatus[],
  spendTodayMicros: number
): BudgetMetricSample[] {
  const samples: BudgetMetricSample[] = [
    { name: 'opsknight_intelligence_ai_spend_today_usd', value: spendTodayMicros / 1_000_000 },
  ];
  for (const scope of ['GLOBAL', 'TEAM', 'CAPABILITY'] as const) {
    const label = scope.toLowerCase();
    const scoped = statuses.filter(status => status.scope === scope);
    samples.push({
      name: 'opsknight_intelligence_ai_budget_utilization_max_ratio',
      value: Math.max(0, ...scoped.map(status => status.utilization)),
      labels: { scope: label },
    });
    for (const threshold of BUDGET_ALERT_THRESHOLDS)
      samples.push({
        name: 'opsknight_intelligence_ai_budgets_over_threshold',
        value: scoped.filter(status => status.utilization >= threshold).length,
        labels: { scope: label, threshold: String(threshold) },
      });
  }
  return samples;
}

// ---------- Spend read model ----------

export interface SpendSlice {
  key: string;
  label: string;
  requests: number;
  tokens: number;
  costMicros: number;
  unpricedRequests: number;
}

export interface SpendBreakdown {
  days: number;
  from: string;
  to: string;
  daily: Array<{ day: string; tokens: number; costMicros: number }>;
  byTeam: SpendSlice[];
  byCapability: SpendSlice[];
  byModel: SpendSlice[];
  total: { requests: number; tokens: number; costMicros: number; unpricedRequests: number };
}

const SLICE_LIMIT = 12;

/** Spend for the last 7 or 30 UTC days (today included), grouped by team, capability and model. */
export async function getSpendBreakdown(
  days: 7 | 30,
  now: Date = new Date()
): Promise<SpendBreakdown> {
  const keys = Array.from({ length: days }, (_, index) =>
    utcDay(new Date(now.getTime() - (days - 1 - index) * 86_400_000))
  );
  const from = keys[0];
  const to = keys[keys.length - 1];
  const rows = await prisma.aiUsageBreakdownDay.findMany({
    where: { day: { gte: from, lte: to } },
    select: {
      day: true,
      teamId: true,
      capability: true,
      providerKind: true,
      model: true,
      requests: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
      unpricedRequests: true,
    },
    // Bounded: days × teams × capabilities × models. A runaway cardinality is cut, not loaded.
    take: 20_000,
  });
  const teamIds = [...new Set(rows.map(row => row.teamId).filter(Boolean))];
  const teams = teamIds.length
    ? await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      })
    : [];
  const teamNames = new Map(teams.map(team => [team.id, team.name]));
  const group = (keyOf: (row: (typeof rows)[number]) => [string, string]) => {
    const slices = new Map<string, SpendSlice>();
    for (const row of rows) {
      const [key, label] = keyOf(row);
      const slice = slices.get(key) ?? {
        key,
        label,
        requests: 0,
        tokens: 0,
        costMicros: 0,
        unpricedRequests: 0,
      };
      slice.requests += row.requests;
      slice.tokens += row.inputTokens + row.outputTokens;
      slice.costMicros += Number(row.costMicros);
      slice.unpricedRequests += row.unpricedRequests;
      slices.set(key, slice);
    }
    const sorted = [...slices.values()].sort(
      (a, b) => b.costMicros - a.costMicros || b.tokens - a.tokens || a.key.localeCompare(b.key)
    );
    if (sorted.length <= SLICE_LIMIT) return sorted;
    const rest = sorted.slice(SLICE_LIMIT - 1).reduce(
      (other, slice) => ({
        ...other,
        requests: other.requests + slice.requests,
        tokens: other.tokens + slice.tokens,
        costMicros: other.costMicros + slice.costMicros,
        unpricedRequests: other.unpricedRequests + slice.unpricedRequests,
      }),
      { key: 'other', label: 'Other', requests: 0, tokens: 0, costMicros: 0, unpricedRequests: 0 }
    );
    return [...sorted.slice(0, SLICE_LIMIT - 1), rest];
  };
  const daily = new Map(keys.map(day => [day, { day, tokens: 0, costMicros: 0 }]));
  for (const row of rows) {
    const entry = daily.get(row.day);
    if (!entry) continue;
    entry.tokens += row.inputTokens + row.outputTokens;
    entry.costMicros += Number(row.costMicros);
  }
  const byModel = group(row => [`${row.providerKind}:${row.model}`, row.model]);
  return {
    days,
    from,
    to,
    daily: [...daily.values()],
    byTeam: group(row =>
      row.teamId ? [row.teamId, teamNames.get(row.teamId) ?? 'Deleted team'] : ['', 'No team']
    ),
    byCapability: group(row => [row.capability, row.capability]),
    byModel,
    total: byModel.reduce(
      (total, slice) => ({
        requests: total.requests + slice.requests,
        tokens: total.tokens + slice.tokens,
        costMicros: total.costMicros + slice.costMicros,
        unpricedRequests: total.unpricedRequests + slice.unpricedRequests,
      }),
      { requests: 0, tokens: 0, costMicros: 0, unpricedRequests: 0 }
    ),
  };
}
