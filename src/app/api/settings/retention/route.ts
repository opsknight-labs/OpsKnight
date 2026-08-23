import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import {
  getRetentionPolicy,
  updateRetentionPolicy,
  type RetentionPolicy,
} from '@/lib/retention-policy';
import { getStorageStats, performDataCleanup } from '@/lib/data-cleanup';
import { assertAdmin } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';

const RetentionUpdateSchema = z
  .object({
    incidentRetentionDays: z.number().int().min(1).max(3650).optional(),
    alertRetentionDays: z.number().int().min(1).max(3650).optional(),
    logRetentionDays: z.number().int().min(1).max(3650).optional(),
    metricsRetentionDays: z.number().int().min(1).max(3650).optional(),
    realTimeWindowDays: z.number().int().min(1).max(365).optional(),
  })
  .refine(data => Object.keys(data).length > 0, { message: 'No valid fields provided' });

/**
 * GET /api/settings/retention
 * Fetch current retention policy and storage statistics
 */
export async function GET() {
  try {
    await assertAdmin();

    const [policy, stats] = await Promise.all([getRetentionPolicy(), getStorageStats()]);

    return NextResponse.json({
      policy,
      stats,
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
          logRetentionDays: 30,
          metricsRetentionDays: 365,
          realTimeWindowDays: 60,
        },
        {
          name: 'Extended (2 years)',
          incidentRetentionDays: 730,
          alertRetentionDays: 365,
          logRetentionDays: 90,
          metricsRetentionDays: 730,
          realTimeWindowDays: 90,
        },
        {
          name: 'Enterprise (5 years)',
          incidentRetentionDays: 1825,
          alertRetentionDays: 730,
          logRetentionDays: 180,
          metricsRetentionDays: 1825,
          realTimeWindowDays: 90,
        },
        {
          name: 'Compliance (7 years)',
          incidentRetentionDays: 2555,
          alertRetentionDays: 1825,
          logRetentionDays: 365,
          metricsRetentionDays: 2555,
          realTimeWindowDays: 90,
        },
      ],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch retention settings';
    if (msg.includes('Unauthorized') || msg.includes('Admin access required')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    logger.error('[API] Failed to fetch retention settings', { error });
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/retention
 * Update retention policy settings
 */
export async function PUT(request: NextRequest) {
  try {
    const admin = await assertAdmin();
    const body = await request.json();
    const parsed = RetentionUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid retention settings', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const updates: Partial<RetentionPolicy> = parsed.data;
    const updatedPolicy = await updateRetentionPolicy(updates);

    await logAudit({
      action: 'retention.policy.updated',
      entityType: 'USER',
      entityId: admin.id,
      actorId: admin.id,
      details: updates,
    });

    logger.info('[API] Retention policy updated', {
      userId: admin.id,
      updates,
    });

    return NextResponse.json({
      success: true,
      policy: updatedPolicy,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to update settings';
    if (msg.includes('Unauthorized') || msg.includes('Admin access required')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    logger.error('[API] Failed to update retention settings', { error });
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

/**
 * POST /api/settings/retention
 * Trigger data cleanup (dry run or actual)
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await assertAdmin();
    const body = await request.json();
    const dryRun = body.dryRun !== false; // Default to dry run for safety

    const result = await performDataCleanup(dryRun);

    if (!dryRun) {
      await logAudit({
        action: 'retention.data.purged',
        entityType: 'USER',
        entityId: admin.id,
        actorId: admin.id,
        details: JSON.parse(JSON.stringify(result)),
      });
    }

    logger.info('[API] Data cleanup executed', {
      userId: admin.id,
      dryRun,
      result,
    });

    return NextResponse.json({
      success: true,
      dryRun,
      result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to execute cleanup';
    if (msg.includes('Unauthorized') || msg.includes('Admin access required')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    logger.error('[API] Data cleanup failed', { error });
    return NextResponse.json({ error: 'Failed to execute cleanup' }, { status: 500 });
  }
}
