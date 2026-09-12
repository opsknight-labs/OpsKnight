'use server';

import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import {
  IncidentResponsePolicyError,
  saveIncidentSlaPolicy,
} from '@/lib/incident-sla/policy-config';
import {
  saveClassificationPolicy,
  saveWorkspaceClassificationPolicy,
} from '@/lib/incidents/classification-policy';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { explainIncidentResponsePolicy } from '@/lib/incidents/response-policy';
import { getUserPermissions } from '@/lib/rbac';
import { saveSupportHoursPolicy } from '@/lib/incidents/support-hours-policy';
import { emitAuditEvent } from '@/lib/audit';
import {
  invalidateSlaSchedulerMode,
  MIN_CLEAN_SHADOW_CHECKS,
} from '@/lib/incident-sla/scheduler-control';

export type IncidentResponsePolicySaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      code: 'VALIDATION' | 'CONFLICT' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'UNEXPECTED';
      message: string;
    };

function policySaveError(
  error: unknown,
  fallbackMessage: string
): IncidentResponsePolicySaveResult {
  if (error instanceof ZodError) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: error.issues[0]?.message ?? 'Check the policy values and try again.',
    };
  }
  if (error instanceof IncidentResponsePolicyError) {
    if (error.code === 'CONFLICT') {
      logger.warn('[IncidentResponsePolicy] Save conflict', { code: error.code });
      return {
        ok: false,
        code: error.code,
        message:
          'This policy changed in another session. Reload the page and review the latest version.',
      };
    }
    if (error.code === 'UNAUTHORIZED') {
      logger.warn('[IncidentResponsePolicy] Unauthorized save attempt', { code: error.code });
      return {
        ok: false,
        code: error.code,
        message: 'You no longer have permission to change this policy.',
      };
    }
    return { ok: false, code: error.code, message: 'The selected service no longer exists.' };
  }

  logger.error('[IncidentResponsePolicy] Save failed', { error });
  return { ok: false, code: 'UNEXPECTED', message: fallbackMessage };
}

export async function saveScopedClassificationPolicyAction(
  input: unknown
): Promise<IncidentResponsePolicySaveResult> {
  try {
    const policy = await saveClassificationPolicy(input);
    return { ok: true, version: policy.version };
  } catch (error) {
    return policySaveError(error, 'Unable to save the scoped classification policy. Try again.');
  }
}

export async function saveIncidentSlaPolicyAction(
  input: unknown
): Promise<IncidentResponsePolicySaveResult> {
  try {
    const policy = await saveIncidentSlaPolicy(input);
    return { ok: true, version: policy.version };
  } catch (error) {
    return policySaveError(error, 'Unable to save the incident response SLA policy. Try again.');
  }
}

export async function saveWorkspaceClassificationPolicyAction(
  input: unknown
): Promise<IncidentResponsePolicySaveResult> {
  try {
    const policy = await saveWorkspaceClassificationPolicy(input);
    return { ok: true, version: policy.version };
  } catch (error) {
    return policySaveError(error, 'Unable to save the alert classification policy. Try again.');
  }
}

export async function previewResponsePolicyAction(input: unknown) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated || !permissions.capabilities.includes('admin.manage'))
    return { ok: false as const, message: 'Admin access required.' };
  try {
    const value = await prisma.$transaction(tx =>
      explainIncidentResponsePolicy(tx, input as never)
    );
    return { ok: true as const, value };
  } catch {
    return { ok: false as const, message: 'Unable to resolve this policy preview.' };
  }
}

export async function saveSupportHoursPolicyAction(
  input: unknown
): Promise<IncidentResponsePolicySaveResult> {
  try {
    const policy = await saveSupportHoursPolicy(input);
    return { ok: true, version: policy.version };
  } catch (error) {
    return policySaveError(error, 'Unable to save support hours.');
  }
}

const schedulerModeSchema = z.enum(['LEGACY', 'SHADOW', 'INDEXED']);

export async function saveSlaSchedulerModeAction(rawMode: unknown) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated || !permissions.id)
    return { ok: false as const, message: 'Authentication required.' };
  if (!permissions.capabilities.includes('admin.manage'))
    return { ok: false as const, message: 'Admin access required.' };
  const parsed = schedulerModeSchema.safeParse(rawMode);
  if (!parsed.success) return { ok: false as const, message: 'Invalid scheduler mode.' };
  const mode = parsed.data;
  const rejection = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(1762184301)`;
    const current = await tx.systemConfig.findUnique({
      where: { key: 'incident_sla_scheduler' },
      select: { value: true },
    });
    const currentValue =
      current?.value && typeof current.value === 'object' && !Array.isArray(current.value)
        ? (current.value as Record<string, unknown>)
        : {};
    if (mode === 'INDEXED') {
      if (currentValue.mode !== 'SHADOW') return 'Run Shadow mode before enabling Indexed mode.';
      if (Number(currentValue.lastShadowMismatchCount ?? 1) !== 0)
        return 'Resolve Shadow mismatches before enabling Indexed mode.';
      if (Number(currentValue.consecutiveCleanChecks ?? 0) < MIN_CLEAN_SHADOW_CHECKS)
        return `Wait for ${MIN_CLEAN_SHADOW_CHECKS} consecutive clean Shadow checks before enabling Indexed mode.`;
      const rows = await tx.$queryRaw<Array<{ ready: boolean; missing_hints: bigint }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = 'idx_incident_next_sla_transition' AND i.indisvalid
        ) AS ready,
        (SELECT COUNT(*) FROM "Incident" i
          JOIN "Service" s ON s."id" = i."serviceId"
          WHERE i."status" IN ('OPEN', 'ACKNOWLEDGED')
            AND s."serviceNotifyOnSlaBreach" = true
            AND i."nextSlaTransitionAt" IS NULL)::bigint AS missing_hints
      `;
      if (!rows[0]?.ready) return 'Install the SLA scheduler index before enabling Indexed mode.';
      if (Number(rows[0]?.missing_hints ?? 0) > 0)
        return 'Run Shadow mode until all active incidents have scheduling hints.';
    }
    const nextValue =
      mode === 'SHADOW'
        ? { mode, consecutiveCleanChecks: 0, lastShadowMismatchCount: 0 }
        : { ...currentValue, mode };
    await tx.systemConfig.upsert({
      where: { key: 'incident_sla_scheduler' },
      create: { key: 'incident_sla_scheduler', value: nextValue, updatedBy: permissions.id },
      update: { value: nextValue as Prisma.InputJsonValue, updatedBy: permissions.id },
    });
    await emitAuditEvent(
      {
        action: 'incident_sla.scheduler.mode_changed',
        source: 'UI',
        target: { type: 'SYSTEM_CONFIG', id: 'incident_sla_scheduler' },
        actor: { type: 'USER', id: permissions.id },
        metadata: { mode },
      },
      tx
    );
    return null;
  });
  if (rejection) return { ok: false as const, message: rejection };
  invalidateSlaSchedulerMode();
  revalidatePath('/settings/incident-sla');
  return { ok: true as const, mode };
}
