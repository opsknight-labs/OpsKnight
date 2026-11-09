'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import {
  createHeartbeatMonitor,
  createMaintenanceWindow,
  createSuppressionRule,
  deleteHeartbeatMonitor,
  deleteSuppressionRule,
  endMaintenanceWindow,
  noiseControlDefinitionSchema,
  orchestrationRuleSchema,
  reversePrePagingDecision,
  saveNoiseControlPolicy,
  setHeartbeatMonitorEnabled,
  setMaintenanceWindowEnabled,
  setSuppressionRuleEnabled,
  simulatePrePagingControls,
  suppressionRuleInputSchema,
  type SimulationOutcome,
} from '@/lib/intelligence/noise-controls';

export type NoiseActionState = {
  message: string;
  ok: boolean;
  /** Returned once, right after a heartbeat monitor is created. */
  token?: string;
  simulation?: SimulationOutcome;
};

const PATH = '/settings/intelligence/noise-controls';
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function failure(error: unknown): NoiseActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return {
      message: detail ? `${error.userMessage} (${detail.message})` : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Intelligence] Noise control action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const optional = (form: FormData, name: string) => text(form, name) || undefined;
const flag = (form: FormData, name: string) => form.get(name) === 'on' || form.get(name) === 'true';
const integer = (form: FormData, name: string, fallback: number) => {
  const parsed = Number.parseInt(text(form, name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const actorOf = (user: { id: string }) => ({ actorId: user.id, source: 'UI' as const });

function parseJson(form: FormData, name: string): unknown {
  const raw = text(form, name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      fields: [{ field: name, message: 'Not valid JSON' }],
    });
  }
}

export async function savePolicyAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const orchestration = parseJson(form, 'orchestration');
    const definition = noiseControlDefinitionSchema.parse({
      schemaVersion: 1,
      allowHighUrgency: flag(form, 'allowHighUrgency'),
      contentDedup: {
        enabled: flag(form, 'contentDedupEnabled'),
        windowSeconds: integer(form, 'contentDedupWindowSeconds', 900),
        requireLabelSubset: flag(form, 'contentDedupRequireLabelSubset'),
      },
      flapping: {
        enabled: flag(form, 'flappingEnabled'),
        windowSeconds: integer(form, 'flappingWindowSeconds', 180),
        threshold: integer(form, 'flappingThreshold', 4),
        keyOnFingerprint: flag(form, 'flappingKeyOnFingerprint'),
      },
      storm: {
        enabled: flag(form, 'stormEnabled'),
        threshold: integer(form, 'stormThreshold', 10),
        windowSeconds: integer(form, 'stormWindowSeconds', 60),
        holdSeconds: integer(form, 'stormHoldSeconds', 0),
        topology: flag(form, 'stormTopology'),
      },
      orchestration: {
        rules: Array.isArray(orchestration)
          ? orchestration.map(rule => orchestrationRuleSchema.parse(rule))
          : [],
      },
    });
    const view = await saveNoiseControlPolicy(
      {
        serviceId: optional(form, 'serviceId') ?? null,
        mode: text(form, 'mode'),
        definition,
        expectedRevision: integer(form, 'expectedRevision', 0),
        acknowledgeReadiness: flag(form, 'acknowledgeReadiness'),
      },
      actorOf(user)
    );
    revalidatePath(PATH);
    return { message: `Saved (${view.mode}, revision ${view.revision}).`, ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError')
      return { message: `Check the fields: ${error.message.slice(0, 200)}`, ok: false };
    return failure(error);
  }
}

export async function createWindowAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const effect = text(form, 'effect') === 'DOWNGRADE' ? 'DOWNGRADE' : 'SUPPRESS';
    await createMaintenanceWindow(
      {
        name: text(form, 'name'),
        description: optional(form, 'description'),
        scope: text(form, 'scope'),
        serviceId: optional(form, 'serviceId'),
        teamId: optional(form, 'teamId'),
        labelKey: optional(form, 'labelKey'),
        labelValue: optional(form, 'labelValue'),
        startsAt: new Date(text(form, 'startsAt')).toISOString(),
        endsAt: new Date(text(form, 'endsAt')).toISOString(),
        recurrence: optional(form, 'recurrence') ?? null,
        effect,
        downgradeUrgency: effect === 'DOWNGRADE' ? optional(form, 'downgradeUrgency') : undefined,
      },
      actorOf(user)
    );
    revalidatePath(PATH);
    return { message: 'Maintenance window saved.', ok: true };
  } catch (error) {
    if (error instanceof RangeError)
      return { message: 'Enter valid start and end times.', ok: false };
    return failure(error);
  }
}

export async function endWindowAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid window.', ok: false };
    const result = await endMaintenanceWindow(id, actorOf(user));
    revalidatePath(PATH);
    return result === 'ended'
      ? { message: 'Maintenance ended; alerts page normally from now.', ok: true }
      : { message: 'That window has already ended.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function toggleWindowAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid window.', ok: false };
    const result = await setMaintenanceWindowEnabled(id, flag(form, 'enabled'), actorOf(user));
    revalidatePath(PATH);
    return result === 'updated'
      ? { message: 'Window updated.', ok: true }
      : { message: 'That window no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function createRuleAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const effect = text(form, 'effect') === 'DOWNGRADE' ? 'DOWNGRADE' : 'SUPPRESS';
    const field = text(form, 'matcherField');
    const matchers = parseJson(form, 'matchers') ?? [
      {
        field,
        key: field === 'label' ? optional(form, 'matcherKey') : undefined,
        op: text(form, 'matcherOp'),
        value: optional(form, 'matcherValue'),
      },
    ];
    await createSuppressionRule(
      {
        name: text(form, 'name'),
        description: optional(form, 'description'),
        serviceId: optional(form, 'serviceId') ?? null,
        matchers,
        effect,
        downgradeUrgency: effect === 'DOWNGRADE' ? optional(form, 'downgradeUrgency') : undefined,
        expiresAt: optional(form, 'expiresAt')
          ? new Date(text(form, 'expiresAt')).toISOString()
          : null,
        ownerId: optional(form, 'ownerId') ?? null,
        origin: text(form, 'origin') === 'SUGGESTED' ? 'SUGGESTED' : 'MANUAL',
        suggestion:
          (parseJson(form, 'suggestion') as Record<string, unknown> | undefined) ?? undefined,
      },
      actorOf(user)
    );
    revalidatePath(PATH);
    return { message: 'Suppression rule saved.', ok: true };
  } catch (error) {
    if (error instanceof RangeError) return { message: 'Enter a valid expiry time.', ok: false };
    return failure(error);
  }
}

export async function toggleRuleAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid rule.', ok: false };
    const result = await setSuppressionRuleEnabled(id, flag(form, 'enabled'), actorOf(user));
    revalidatePath(PATH);
    return result === 'updated'
      ? { message: 'Rule updated.', ok: true }
      : { message: 'That rule no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteRuleAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid rule.', ok: false };
    const result = await deleteSuppressionRule(id, actorOf(user));
    revalidatePath(PATH);
    return result === 'deleted'
      ? { message: 'Rule deleted.', ok: true }
      : { message: 'That rule no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function createHeartbeatAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const { token } = await createHeartbeatMonitor(
      {
        name: text(form, 'name'),
        description: optional(form, 'description'),
        serviceId: text(form, 'serviceId'),
        intervalSeconds: integer(form, 'intervalSeconds', 300),
        graceSeconds: integer(form, 'graceSeconds', 60),
        urgency: text(form, 'urgency') || 'MEDIUM',
      },
      actorOf(user)
    );
    revalidatePath(PATH);
    return {
      message: 'Heartbeat monitor created. Copy the ping URL now; the token is not shown again.',
      ok: true,
      token,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function toggleHeartbeatAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid monitor.', ok: false };
    const result = await setHeartbeatMonitorEnabled(id, flag(form, 'enabled'), actorOf(user));
    revalidatePath(PATH);
    return result === 'updated'
      ? { message: 'Monitor updated.', ok: true }
      : { message: 'That monitor no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteHeartbeatAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid monitor.', ok: false };
    const result = await deleteHeartbeatMonitor(id, actorOf(user));
    revalidatePath(PATH);
    return result === 'deleted'
      ? { message: 'Monitor deleted.', ok: true }
      : { message: 'That monitor no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function reverseDecisionAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!ID.test(id)) return { message: 'Invalid decision.', ok: false };
    const result = await reversePrePagingDecision(id, actorOf(user));
    revalidatePath(PATH);
    if (result.outcome === 'reversed')
      return {
        message: result.incidentId
          ? 'Reversed; the alert was re-ingested and pages normally.'
          : 'Reversed and recorded as a wrong decision.',
        ok: true,
      };
    return {
      message:
        result.outcome === 'already_reversed'
          ? 'Already reversed.'
          : 'That decision no longer exists.',
      ok: false,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function simulateAction(
  _state: NoiseActionState,
  form: FormData
): Promise<NoiseActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const settings = await getIntelligenceSettings();
    const simulation = await simulatePrePagingControls(settings, {
      serviceId: optional(form, 'serviceId') ?? null,
      days: integer(form, 'days', 7),
      createdById: user.id,
    });
    return {
      message: `${simulation.incidentsEvaluated} incidents replayed over ${simulation.days} days: ${simulation.pagesAvoided} would not have paged, ${simulation.downgraded} downgraded, ${simulation.held} held.`,
      ok: true,
      simulation,
    };
  } catch (error) {
    return failure(error);
  }
}

export { suppressionRuleInputSchema };
