import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getAlertQualityLeaderboard } from '../triage/alert-quality';
import { parseOrThrow, type IntelligenceActor } from '../settings/service';
import {
  DEFAULT_NOISE_CONTROL_DEFINITION,
  GLOBAL_NOISE_SCOPE_KEY,
  heartbeatMonitorInputSchema,
  maintenanceWindowInputSchema,
  noiseControlPolicyInputSchema,
  noiseScopeKey,
  suppressionRuleInputSchema,
  type Matcher,
  type NoiseControlDefinition,
  type NoiseControlModeValue,
} from './contract';
import { refreshPrePagingSnapshot } from './cache';
import { validateWindowTiming, windowSpans } from './recurrence';

type Client = Prisma.TransactionClient | typeof prisma;

function invalid(field: string, message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', fields: [{ field, message }] });
}

async function assertServiceExists(client: Client, serviceId: string) {
  const service = await client.service.findUnique({
    where: { id: serviceId },
    select: { id: true },
  });
  if (!service) throw invalid('serviceId', 'Unknown service');
}

/** Refresh the local snapshot after a change; other processes pick it up within 30 seconds. */
function refreshSoon() {
  void refreshPrePagingSnapshot().catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------------

export interface NoiseControlPolicyView {
  scopeKey: string;
  serviceId: string | null;
  mode: NoiseControlModeValue;
  definition: NoiseControlDefinition;
  /** 0 when no row exists yet: defaults apply and the first save creates it. */
  revision: number;
  updatedAt: Date | null;
}

export async function getNoiseControlPolicy(
  serviceId: string | null,
  client: Client = prisma
): Promise<NoiseControlPolicyView> {
  const row = await client.noiseControlPolicy.findUnique({
    where: { scopeKey: noiseScopeKey(serviceId) },
  });
  if (!row)
    return {
      scopeKey: noiseScopeKey(serviceId),
      serviceId,
      mode: 'OFF',
      definition: DEFAULT_NOISE_CONTROL_DEFINITION,
      revision: 0,
      updatedAt: null,
    };
  const parsed = DEFAULT_NOISE_CONTROL_DEFINITION && (row.definition as NoiseControlDefinition);
  return {
    scopeKey: row.scopeKey,
    serviceId: row.serviceId,
    mode: row.mode,
    definition: parsed,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

export async function listNoiseControlPolicies(client: Client = prisma) {
  const rows = await client.noiseControlPolicy.findMany({
    orderBy: [{ scopeKey: 'asc' }],
    take: 2_000,
    select: {
      scopeKey: true,
      serviceId: true,
      mode: true,
      revision: true,
      updatedAt: true,
      service: { select: { name: true } },
    },
  });
  return rows.map(row => ({
    scopeKey: row.scopeKey,
    serviceId: row.serviceId,
    serviceName:
      row.service?.name ??
      (row.scopeKey === GLOBAL_NOISE_SCOPE_KEY ? 'All services' : row.scopeKey),
    mode: row.mode,
    revision: row.revision,
    updatedAt: row.updatedAt,
  }));
}

export const NOISE_READINESS = {
  windowDays: 7,
  minimumShadowDecisions: 50,
  maxFalsePositiveRate: 0.02,
} as const;

export interface NoiseReadiness {
  ready: boolean;
  shadowDecisions: number;
  reversed: number;
  falsePositiveRate: number;
  windowDays: number;
  minimumShadowDecisions: number;
  maxFalsePositiveRate: number;
}

/**
 * The SHADOW→ON gate: enough shadow decisions over the last week, and few enough that an operator marked
 * wrong (reversed). Mirrors the certification idea used for AUTO correlation, at a lighter weight.
 */
export async function assessNoiseReadiness(
  serviceId: string | null,
  now: Date = new Date(),
  client: Client = prisma
): Promise<NoiseReadiness> {
  const since = new Date(now.getTime() - NOISE_READINESS.windowDays * 86_400_000);
  const where = {
    createdAt: { gte: since },
    mode: 'SHADOW' as const,
    ...(serviceId ? { serviceId } : {}),
  };
  const [shadowDecisions, reversed] = await Promise.all([
    client.prePagingDecision.count({ where }),
    client.prePagingDecision.count({ where: { ...where, reversedAt: { not: null } } }),
  ]);
  const falsePositiveRate = shadowDecisions === 0 ? 0 : reversed / shadowDecisions;
  return {
    ready:
      shadowDecisions >= NOISE_READINESS.minimumShadowDecisions &&
      falsePositiveRate <= NOISE_READINESS.maxFalsePositiveRate,
    shadowDecisions,
    reversed,
    falsePositiveRate: Math.round(falsePositiveRate * 10_000) / 10_000,
    windowDays: NOISE_READINESS.windowDays,
    minimumShadowDecisions: NOISE_READINESS.minimumShadowDecisions,
    maxFalsePositiveRate: NOISE_READINESS.maxFalsePositiveRate,
  };
}

/** Caller must authorize INTELLIGENCE_MANAGE. Compare-and-set on revision; ON needs readiness or an explicit acknowledgement. */
export async function saveNoiseControlPolicy(
  input: unknown,
  actor: IntelligenceActor
): Promise<NoiseControlPolicyView> {
  const parsed = parseOrThrow(noiseControlPolicyInputSchema, input);
  const serviceId = parsed.serviceId ?? null;
  const scopeKey = noiseScopeKey(serviceId);
  const view = await prisma.$transaction(async tx => {
    if (serviceId) await assertServiceExists(tx, serviceId);
    const previous = await tx.noiseControlPolicy.findUnique({ where: { scopeKey } });
    if ((previous?.revision ?? 0) !== parsed.expectedRevision)
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    if (parsed.mode === 'ON' && previous?.mode !== 'ON' && !parsed.acknowledgeReadiness) {
      const readiness = await assessNoiseReadiness(serviceId, new Date(), tx);
      if (!readiness.ready)
        throw invalid(
          'mode',
          `Run in SHADOW first: ${readiness.shadowDecisions}/${readiness.minimumShadowDecisions} shadow decisions in ${readiness.windowDays} days, ${Math.round(readiness.falsePositiveRate * 100)}% marked wrong (max ${readiness.maxFalsePositiveRate * 100}%). Tick "I understand" to turn it on anyway.`
        );
    }
    const data = {
      mode: parsed.mode,
      definition: parsed.definition as Prisma.InputJsonValue,
      updatedById: actor.actorId,
    };
    const row = previous
      ? await tx.noiseControlPolicy.update({
          where: { scopeKey },
          data: { ...data, revision: { increment: 1 } },
        })
      : await tx.noiseControlPolicy.create({ data: { ...data, scopeKey, serviceId } });
    await logAudit(
      {
        action: 'intelligence.noise.policy.saved',
        entityType: 'SYSTEM_CONFIG',
        entityId: `noise-policy:${scopeKey}`,
        actorId: actor.actorId,
        source: actor.source,
        oldValue: previous ? { mode: previous.mode, revision: previous.revision } : null,
        newValue: {
          mode: row.mode,
          revision: row.revision,
          acknowledgedReadiness: parsed.acknowledgeReadiness ?? false,
        },
      },
      tx
    );
    return row;
  });
  refreshSoon();
  return {
    scopeKey: view.scopeKey,
    serviceId: view.serviceId,
    mode: view.mode,
    definition: view.definition as NoiseControlDefinition,
    revision: view.revision,
    updatedAt: view.updatedAt,
  };
}

// ---------------------------------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------------------------------

export interface MaintenanceWindowView {
  id: string;
  name: string;
  description: string | null;
  scope: 'SERVICE' | 'TEAM' | 'LABEL' | 'ALL';
  serviceId: string | null;
  serviceName: string | null;
  teamId: string | null;
  labelKey: string | null;
  labelValue: string | null;
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  effect: 'SUPPRESS' | 'DOWNGRADE';
  downgradeUrgency: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  enabled: boolean;
  endedAt: Date | null;
  /** Active right now (an operator-ended window is never active). */
  active: boolean;
  /** Next or current occurrence within the coming 30 days, for the calendar view. */
  nextSpan: { startsAt: Date; endsAt: Date } | null;
}

export async function listMaintenanceWindows(
  options: { includePast?: boolean; limit?: number; now?: Date } = {},
  client: Client = prisma
): Promise<MaintenanceWindowView[]> {
  const now = options.now ?? new Date();
  const rows = await client.maintenanceWindow.findMany({
    where: options.includePast
      ? {}
      : {
          endedAt: null,
          OR: [
            { recurrence: { not: null } },
            { endsAt: { gte: new Date(now.getTime() - 86_400_000) } },
          ],
        },
    orderBy: [{ startsAt: 'asc' }],
    take: Math.min(options.limit ?? 200, 500),
    include: { service: { select: { name: true } } },
  });
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  return rows.map(row => {
    const ended = row.endedAt !== null && row.endedAt.getTime() <= now.getTime();
    const spans =
      ended || !row.enabled
        ? []
        : windowSpans(row.startsAt, row.endsAt, row.recurrence, now, horizon);
    const next = spans[0] ?? null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      scope: row.scope,
      serviceId: row.serviceId,
      serviceName: row.service?.name ?? null,
      teamId: row.teamId,
      labelKey: row.labelKey,
      labelValue: row.labelValue,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      recurrence: row.recurrence,
      effect: row.effect,
      downgradeUrgency: row.downgradeUrgency,
      enabled: row.enabled,
      endedAt: row.endedAt,
      active: next !== null && next.startsAt <= now.getTime() && next.endsAt >= now.getTime(),
      nextSpan: next ? { startsAt: new Date(next.startsAt), endsAt: new Date(next.endsAt) } : null,
    };
  });
}

export async function createMaintenanceWindow(input: unknown, actor: IntelligenceActor) {
  const parsed = parseOrThrow(maintenanceWindowInputSchema, input);
  const startsAt = new Date(parsed.startsAt);
  const endsAt = new Date(parsed.endsAt);
  try {
    validateWindowTiming(startsAt, endsAt, parsed.recurrence ?? null);
  } catch (error) {
    throw invalid('recurrence', (error as Error).message);
  }
  const row = await prisma.$transaction(async tx => {
    if (parsed.serviceId) await assertServiceExists(tx, parsed.serviceId);
    if (parsed.teamId) {
      const team = await tx.team.findUnique({ where: { id: parsed.teamId }, select: { id: true } });
      if (!team) throw invalid('teamId', 'Unknown team');
    }
    const created = await tx.maintenanceWindow.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        scope: parsed.scope,
        serviceId: parsed.scope === 'SERVICE' ? parsed.serviceId! : null,
        teamId: parsed.scope === 'TEAM' ? parsed.teamId! : null,
        labelKey: parsed.scope === 'LABEL' ? parsed.labelKey!.toLowerCase() : null,
        labelValue: parsed.scope === 'LABEL' ? parsed.labelValue! : null,
        startsAt,
        endsAt,
        recurrence: parsed.recurrence ?? null,
        effect: parsed.effect,
        downgradeUrgency: parsed.effect === 'DOWNGRADE' ? parsed.downgradeUrgency! : null,
        statusPageAnnouncementId: parsed.statusPageAnnouncementId ?? null,
        createdById: actor.actorId,
      },
    });
    await logAudit(
      {
        action: 'intelligence.noise.maintenance.created',
        entityType: 'SYSTEM_CONFIG',
        entityId: `maintenance-window:${created.id}`,
        actorId: actor.actorId,
        source: actor.source,
        newValue: {
          name: created.name,
          scope: created.scope,
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt.toISOString(),
          recurrence: created.recurrence,
          effect: created.effect,
        },
      },
      tx
    );
    return created;
  });
  refreshSoon();
  return row;
}

/** "End maintenance now": the window stops matching immediately; history is kept. */
export async function endMaintenanceWindow(
  id: string,
  actor: IntelligenceActor
): Promise<'ended' | 'missing'> {
  const result = await prisma.maintenanceWindow.updateMany({
    where: { id, endedAt: null },
    data: { endedAt: new Date(), endedById: actor.actorId },
  });
  if (result.count !== 1) return 'missing';
  await logAudit({
    action: 'intelligence.noise.maintenance.ended',
    entityType: 'SYSTEM_CONFIG',
    entityId: `maintenance-window:${id}`,
    actorId: actor.actorId,
    source: actor.source,
  });
  refreshSoon();
  return 'ended';
}

export async function setMaintenanceWindowEnabled(
  id: string,
  enabled: boolean,
  actor: IntelligenceActor
): Promise<'updated' | 'missing'> {
  const result = await prisma.maintenanceWindow.updateMany({ where: { id }, data: { enabled } });
  if (result.count !== 1) return 'missing';
  await logAudit({
    action: enabled
      ? 'intelligence.noise.maintenance.enabled'
      : 'intelligence.noise.maintenance.disabled',
    entityType: 'SYSTEM_CONFIG',
    entityId: `maintenance-window:${id}`,
    actorId: actor.actorId,
    source: actor.source,
  });
  refreshSoon();
  return 'updated';
}

// ---------------------------------------------------------------------------------------------------
// Suppression rules
// ---------------------------------------------------------------------------------------------------

export async function listSuppressionRules(client: Client = prisma) {
  const rows = await client.suppressionRule.findMany({
    orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    take: 500,
    include: { service: { select: { name: true } } },
  });
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    serviceId: row.serviceId,
    serviceName: row.service?.name ?? null,
    matchers: (Array.isArray(row.matchers) ? row.matchers : []) as Matcher[],
    effect: row.effect,
    downgradeUrgency: row.downgradeUrgency,
    expiresAt: row.expiresAt,
    ownerId: row.ownerId,
    enabled: row.enabled,
    origin: row.origin,
    createdAt: row.createdAt,
  }));
}

export async function createSuppressionRule(input: unknown, actor: IntelligenceActor) {
  const parsed = parseOrThrow(suppressionRuleInputSchema, input);
  const row = await prisma.$transaction(async tx => {
    if (parsed.serviceId) await assertServiceExists(tx, parsed.serviceId);
    const created = await tx.suppressionRule.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        serviceId: parsed.serviceId ?? null,
        matchers: parsed.matchers as unknown as Prisma.InputJsonValue,
        effect: parsed.effect,
        downgradeUrgency: parsed.effect === 'DOWNGRADE' ? parsed.downgradeUrgency! : null,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        ownerId: parsed.ownerId ?? actor.actorId,
        origin: parsed.origin,
        suggestion: (parsed.suggestion ?? undefined) as Prisma.InputJsonValue | undefined,
        createdById: actor.actorId,
      },
    });
    await logAudit(
      {
        action: 'intelligence.noise.suppression.created',
        entityType: 'SYSTEM_CONFIG',
        entityId: `suppression-rule:${created.id}`,
        actorId: actor.actorId,
        source: actor.source,
        newValue: {
          name: created.name,
          matchers: parsed.matchers as unknown as Prisma.InputJsonValue,
          effect: created.effect,
          expiresAt: created.expiresAt?.toISOString() ?? null,
          origin: created.origin,
        },
      },
      tx
    );
    return created;
  });
  refreshSoon();
  return row;
}

export async function setSuppressionRuleEnabled(
  id: string,
  enabled: boolean,
  actor: IntelligenceActor
): Promise<'updated' | 'missing'> {
  const result = await prisma.suppressionRule.updateMany({ where: { id }, data: { enabled } });
  if (result.count !== 1) return 'missing';
  await logAudit({
    action: enabled
      ? 'intelligence.noise.suppression.enabled'
      : 'intelligence.noise.suppression.disabled',
    entityType: 'SYSTEM_CONFIG',
    entityId: `suppression-rule:${id}`,
    actorId: actor.actorId,
    source: actor.source,
  });
  refreshSoon();
  return 'updated';
}

export async function deleteSuppressionRule(
  id: string,
  actor: IntelligenceActor
): Promise<'deleted' | 'missing'> {
  const result = await prisma.suppressionRule.deleteMany({ where: { id } });
  if (result.count !== 1) return 'missing';
  await logAudit({
    action: 'intelligence.noise.suppression.deleted',
    entityType: 'SYSTEM_CONFIG',
    entityId: `suppression-rule:${id}`,
    actorId: actor.actorId,
    source: actor.source,
  });
  refreshSoon();
  return 'deleted';
}

export interface SuppressionSuggestion {
  serviceId: string;
  serviceName: string;
  reason: string;
  severity: string;
  quickResolved: number;
  rule: {
    name: string;
    serviceId: string;
    matchers: Matcher[];
    effect: 'DOWNGRADE';
    downgradeUrgency: 'LOW';
    origin: 'SUGGESTED';
    suggestion: Record<string, unknown>;
  };
}

/**
 * Suggestions from the alert-quality leaderboard: for each service flagged noisy, the severity whose alerts
 * most often open incidents that clear within five minutes. The proposal is a downgrade, never a
 * suppression, and nothing happens until an operator saves it.
 */
export async function suggestSuppressionRules(
  actor: AuthorizationActor,
  now: Date = new Date(),
  client: Client = prisma
): Promise<SuppressionSuggestion[]> {
  const leaderboard = (await getAlertQualityLeaderboard(actor, now))
    .filter(row => row.flagged)
    .slice(0, 10);
  if (!leaderboard.length) return [];
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const suggestions: SuppressionSuggestion[] = [];
  for (const row of leaderboard) {
    const severities = await client.$queryRaw<Array<{ severity: string | null; count: bigint }>>`
      SELECT a."severity", count(*) AS count
      FROM "Alert" a JOIN "Incident" i ON i."id" = a."incidentId"
      WHERE a."serviceId" = ${row.serviceId} AND a."createdAt" >= ${since} AND a."status" = 'TRIGGERED'
        AND i."resolvedAt" IS NOT NULL AND i."resolvedAt" - i."createdAt" < interval '5 minutes'
      GROUP BY a."severity" ORDER BY count DESC LIMIT 1`;
    const top = severities[0];
    if (!top?.severity) continue;
    const quickResolved = Number(top.count);
    suggestions.push({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      severity: top.severity,
      quickResolved,
      reason: `${Math.round(row.quickResolvedRatio * 100)}% of ${row.serviceName}'s incidents clear within 5 minutes; most come from "${top.severity}" alerts.`,
      rule: {
        name: `Downgrade ${top.severity} alerts on ${row.serviceName}`,
        serviceId: row.serviceId,
        matchers: [{ field: 'severity', op: 'equals', value: top.severity }],
        effect: 'DOWNGRADE',
        downgradeUrgency: 'LOW',
        origin: 'SUGGESTED',
        suggestion: {
          quickResolvedRatio: row.quickResolvedRatio,
          neverAcknowledgedRatio: row.neverAcknowledgedRatio,
          quickResolved,
          since: since.toISOString(),
        },
      },
    });
  }
  return suggestions;
}

// ---------------------------------------------------------------------------------------------------
// Heartbeat monitors
// ---------------------------------------------------------------------------------------------------

export function hashHeartbeatToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function listHeartbeatMonitors(now: Date = new Date(), client: Client = prisma) {
  const rows = await client.heartbeatMonitor.findMany({
    orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    take: 500,
    include: { service: { select: { name: true } } },
  });
  return rows.map(row => {
    const anchor = row.lastPingAt ?? row.createdAt;
    const dueAt = new Date(anchor.getTime() + row.intervalSeconds * 1000);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      serviceId: row.serviceId,
      serviceName: row.service.name,
      tokenPrefix: row.tokenPrefix,
      intervalSeconds: row.intervalSeconds,
      graceSeconds: row.graceSeconds,
      urgency: row.urgency,
      enabled: row.enabled,
      state: row.state,
      lastPingAt: row.lastPingAt,
      missingSince: row.missingSince,
      lastIncidentId: row.lastIncidentId,
      dueAt,
      overdueMs: Math.max(0, now.getTime() - dueAt.getTime() - row.graceSeconds * 1000),
    };
  });
}

/** Returns the monitor and its token; the token is shown once and only its hash is stored. */
export async function createHeartbeatMonitor(input: unknown, actor: IntelligenceActor) {
  const parsed = parseOrThrow(heartbeatMonitorInputSchema, input);
  const token = randomBytes(24).toString('base64url');
  const row = await prisma.$transaction(async tx => {
    await assertServiceExists(tx, parsed.serviceId);
    const created = await tx.heartbeatMonitor.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        serviceId: parsed.serviceId,
        tokenHash: hashHeartbeatToken(token),
        tokenPrefix: token.slice(0, 6),
        intervalSeconds: parsed.intervalSeconds,
        graceSeconds: parsed.graceSeconds,
        urgency: parsed.urgency,
        createdById: actor.actorId,
      },
    });
    await logAudit(
      {
        action: 'intelligence.noise.heartbeat.created',
        entityType: 'SYSTEM_CONFIG',
        entityId: `heartbeat-monitor:${created.id}`,
        actorId: actor.actorId,
        source: actor.source,
        newValue: {
          name: created.name,
          serviceId: created.serviceId,
          intervalSeconds: created.intervalSeconds,
          graceSeconds: created.graceSeconds,
          urgency: created.urgency,
        },
      },
      tx
    );
    return created;
  });
  return { monitor: row, token };
}

export async function setHeartbeatMonitorEnabled(
  id: string,
  enabled: boolean,
  actor: IntelligenceActor
): Promise<'updated' | 'missing'> {
  const result = await prisma.heartbeatMonitor.updateMany({
    where: { id },
    data: enabled
      ? { enabled: true, state: 'PENDING', missingSince: null, lastPingAt: null }
      : { enabled: false, state: 'PAUSED' },
  });
  if (result.count !== 1) return 'missing';
  await logAudit({
    action: enabled
      ? 'intelligence.noise.heartbeat.enabled'
      : 'intelligence.noise.heartbeat.paused',
    entityType: 'SYSTEM_CONFIG',
    entityId: `heartbeat-monitor:${id}`,
    actorId: actor.actorId,
    source: actor.source,
  });
  return 'updated';
}

export async function deleteHeartbeatMonitor(
  id: string,
  actor: IntelligenceActor
): Promise<'deleted' | 'missing'> {
  const result = await prisma.heartbeatMonitor.deleteMany({ where: { id } });
  if (result.count !== 1) return 'missing';
  await logAudit({
    action: 'intelligence.noise.heartbeat.deleted',
    entityType: 'SYSTEM_CONFIG',
    entityId: `heartbeat-monitor:${id}`,
    actorId: actor.actorId,
    source: actor.source,
  });
  return 'deleted';
}
