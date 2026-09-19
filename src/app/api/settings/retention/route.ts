import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  clearRetentionPolicyCache,
  getRetentionPolicy,
  type RetentionPolicy,
} from '@/lib/retention-policy';
import { getStorageStats, performDataCleanup, CleanupConflictError } from '@/lib/data-cleanup';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';
import { jsonSettingsChanged } from '@/lib/settings-api-response';
import {
  SettingsChangedMutationError,
  isSettingsChangedError,
  parseSettingsRevision,
} from '@/lib/settings-result';

const RetentionFieldsSchema = z.object({
  incidentRetentionDays: z.number().int().min(30).max(3650).optional(),
  alertRetentionDays: z.number().int().min(7).max(3650).optional(),
  logRetentionDays: z.number().int().min(1).max(3650).optional(),
  metricsRetentionDays: z.number().int().min(30).max(3650).optional(),
  realTimeWindowDays: z.number().int().min(7).max(365).optional(),
  completedPrivacyRequestRetentionDays: z.number().int().min(30).max(3650).optional(),
  expiredPrivacyArtifactRetentionDays: z.number().int().min(1).max(365).optional(),
  unsubscribedSubscriberRetentionDays: z.number().int().min(1).max(3650).optional(),
});

const RetentionPolicyPatchSchema = RetentionFieldsSchema.refine(hasRetentionFieldUpdate, {
  message: 'No valid fields provided',
});

const RetentionUpdateSchema = RetentionFieldsSchema.extend({
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
}).refine(hasRetentionFieldUpdate, {
  message: 'No valid fields provided',
});

function hasRetentionFieldUpdate(data: Partial<RetentionPolicy>): boolean {
  return (
    data.incidentRetentionDays !== undefined ||
    data.alertRetentionDays !== undefined ||
    data.logRetentionDays !== undefined ||
    data.metricsRetentionDays !== undefined ||
    data.realTimeWindowDays !== undefined ||
    data.completedPrivacyRequestRetentionDays !== undefined ||
    data.expiredPrivacyArtifactRetentionDays !== undefined ||
    data.unsubscribedSubscriberRetentionDays !== undefined
  );
}

function retentionValidationError(error: z.ZodError) {
  return new AppError({
    code: 'VALIDATION_FAILED',
    userMessage: 'Invalid retention settings',
    fields: error.issues.map(issue => ({
      field: issue.path.join('.') || 'request',
      code: issue.code,
      message: issue.message,
    })),
  });
}

function validateEffectivePolicy(policy: RetentionPolicy) {
  if (policy.realTimeWindowDays > policy.metricsRetentionDays) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Real-time window cannot exceed metrics retention period',
      fields: [
        {
          field: 'realTimeWindowDays',
          code: 'cross_field_constraint',
          message: 'Real-time window cannot exceed metrics retention period',
        },
      ],
    });
  }
}

function retentionAuditSnapshot(policy: RetentionPolicy): Prisma.InputJsonObject {
  return {
    incidentRetentionDays: policy.incidentRetentionDays,
    alertRetentionDays: policy.alertRetentionDays,
    logRetentionDays: policy.logRetentionDays,
    metricsRetentionDays: policy.metricsRetentionDays,
    realTimeWindowDays: policy.realTimeWindowDays,
    businessHoursTimeZone: policy.businessHoursTimeZone,
    completedPrivacyRequestRetentionDays: policy.completedPrivacyRequestRetentionDays,
    expiredPrivacyArtifactRetentionDays: policy.expiredPrivacyArtifactRetentionDays,
    unsubscribedSubscriberRetentionDays: policy.unsubscribedSubscriberRetentionDays,
  };
}

export async function GET() {
  try {
    await assertCapability(CAPABILITIES.RETENTION_READ);
    const [policy, stats, settings] = await Promise.all([
      getRetentionPolicy(),
      getStorageStats(),
      prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { updatedAt: true },
      }),
    ]);

    return jsonOk({
      policy,
      stats,
      updatedAt: settings?.updatedAt?.toISOString() ?? null,
      presets: [
        {
          name: 'Minimal (90 days)',
          incidentRetentionDays: 90,
          alertRetentionDays: 30,
          logRetentionDays: 14,
          metricsRetentionDays: 90,
          realTimeWindowDays: 30,
        },
        {
          name: 'Standard (1 year)',
          incidentRetentionDays: 365,
          alertRetentionDays: 180,
          logRetentionDays: 365,
          metricsRetentionDays: 365,
          realTimeWindowDays: 60,
        },
        {
          name: 'Extended (2 years)',
          incidentRetentionDays: 730,
          alertRetentionDays: 365,
          logRetentionDays: 730,
          metricsRetentionDays: 730,
          realTimeWindowDays: 90,
        },
        {
          name: 'Enterprise (5 years)',
          incidentRetentionDays: 1825,
          alertRetentionDays: 730,
          logRetentionDays: 1825,
          metricsRetentionDays: 1825,
          realTimeWindowDays: 90,
        },
        {
          name: 'Compliance (7 years)',
          incidentRetentionDays: 2555,
          alertRetentionDays: 1825,
          logRetentionDays: 2555,
          metricsRetentionDays: 2555,
          realTimeWindowDays: 90,
        },
      ],
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    logger.error('[API] Failed to fetch retention settings', { error });
    return jsonError('Failed to fetch settings', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const admin = await assertCapability(CAPABILITIES.RETENTION_MANAGE);

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = RetentionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(retentionValidationError(parsed.error), undefined, {
        issues: parsed.error.issues,
      });
    }

    const { expectedUpdatedAt = null, ...parsedUpdates } = parsed.data;
    const updates: Partial<RetentionPolicy> = parsedUpdates;
    const [current, existing] = await Promise.all([
      getRetentionPolicy(),
      prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { updatedAt: true },
      }),
    ]);
    const expectedRevision = parseSettingsRevision(expectedUpdatedAt);
    if (existing && !expectedRevision) return jsonSettingsChanged();
    if (!existing && expectedRevision) return jsonSettingsChanged();

    const effective: RetentionPolicy = { ...current, ...updates };
    validateEffectivePolicy(effective);

    const updatedAt = await prisma.$transaction(async tx => {
      if (existing) {
        const updated = await tx.systemSettings.updateMany({
          where: { id: 'default', updatedAt: expectedRevision! },
          data: {
            incidentRetentionDays: effective.incidentRetentionDays,
            alertRetentionDays: effective.alertRetentionDays,
            logRetentionDays: effective.logRetentionDays,
            metricsRetentionDays: effective.metricsRetentionDays,
            realTimeWindowDays: effective.realTimeWindowDays,
            completedPrivacyRequestRetentionDays: effective.completedPrivacyRequestRetentionDays,
            expiredPrivacyArtifactRetentionDays: effective.expiredPrivacyArtifactRetentionDays,
            unsubscribedSubscriberRetentionDays: effective.unsubscribedSubscriberRetentionDays,
          },
        });
        if (updated.count !== 1) throw new SettingsChangedMutationError();
      } else {
        await tx.systemSettings.create({
          data: {
            id: 'default',
            incidentRetentionDays: effective.incidentRetentionDays,
            alertRetentionDays: effective.alertRetentionDays,
            logRetentionDays: effective.logRetentionDays,
            metricsRetentionDays: effective.metricsRetentionDays,
            realTimeWindowDays: effective.realTimeWindowDays,
            businessHoursTimeZone: effective.businessHoursTimeZone,
            completedPrivacyRequestRetentionDays: effective.completedPrivacyRequestRetentionDays,
            expiredPrivacyArtifactRetentionDays: effective.expiredPrivacyArtifactRetentionDays,
            unsubscribedSubscriberRetentionDays: effective.unsubscribedSubscriberRetentionDays,
          },
        });
      }

      await logAudit(
        {
          action: 'retention.policy.updated',
          entityType: 'USER',
          entityId: admin.id,
          actorId: admin.id,
          oldValue: retentionAuditSnapshot(current),
          newValue: retentionAuditSnapshot(effective),
          details: { changedFields: Object.keys(updates) },
        },
        tx
      );

      const saved = await tx.systemSettings.findUniqueOrThrow({
        where: { id: 'default' },
        select: { updatedAt: true },
      });
      return saved.updatedAt.toISOString();
    });

    clearRetentionPolicyCache();
    logger.info('[API] Retention policy updated', { userId: admin.id, updates });
    return jsonOk({ success: true, policy: effective, updatedAt });
  } catch (error) {
    if (
      isSettingsChangedError(error) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      return jsonSettingsChanged();
    }
    if (isAppError(error)) return jsonError(error);
    logger.error('[API] Failed to update retention settings', { error });
    return jsonError('Failed to update settings', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const dryRun = payload.dryRun !== false;

    const user = await assertCapability(
      dryRun ? CAPABILITIES.RETENTION_READ : CAPABILITIES.RETENTION_MANAGE
    );

    let policyOverride: Partial<RetentionPolicy> | undefined;
    if (payload.policy && typeof payload.policy === 'object') {
      const parsed = RetentionPolicyPatchSchema.safeParse(payload.policy);
      if (!parsed.success) {
        return jsonError(retentionValidationError(parsed.error), undefined, {
          issues: parsed.error.issues,
        });
      }
      const current = await getRetentionPolicy();
      const effective = { ...current, ...parsed.data };
      validateEffectivePolicy(effective);
      policyOverride = parsed.data;
    }

    const result = await performDataCleanup(dryRun, policyOverride);

    if (!dryRun) {
      await logAudit({
        action: 'retention.data.purged',
        entityType: 'USER',
        entityId: user.id,
        actorId: user.id,
        details: JSON.parse(JSON.stringify(result)),
      });
    }

    logger.info('[API] Data cleanup executed', {
      userId: user.id,
      dryRun,
      result,
      policyOverride,
    });
    return jsonOk({ success: true, dryRun, result });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    if (error instanceof CleanupConflictError) return jsonError(error.message, error.status);
    logger.error('[API] Data cleanup failed', { error });
    return jsonError('Failed to execute cleanup', 500);
  }
}
