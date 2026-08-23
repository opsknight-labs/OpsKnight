import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  getRetentionPolicy,
  updateRetentionPolicy,
  type RetentionPolicy,
} from '@/lib/retention-policy';
import { getStorageStats, performDataCleanup } from '@/lib/data-cleanup';
import { logAudit } from '@/lib/audit';

/**
 * GET /api/settings/retention
 * Fetch current retention policy and storage statistics
 */
export async function GET() {
  try {
    const session = await getServerSession(await getAuthOptions());

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check for admin role
    const userRole = (session.user as any).role;
    if (userRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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
    const session = await getServerSession(await getAuthOptions());

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = (session.user as any).role;
    if (userRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();

    // Validate input
    const updates: Partial<RetentionPolicy> = {};

    if (typeof body.incidentRetentionDays === 'number') {
      updates.incidentRetentionDays = body.incidentRetentionDays;
    }
    if (typeof body.alertRetentionDays === 'number') {
      updates.alertRetentionDays = body.alertRetentionDays;
    }
    if (typeof body.logRetentionDays === 'number') {
      updates.logRetentionDays = body.logRetentionDays;
    }
    if (typeof body.metricsRetentionDays === 'number') {
      updates.metricsRetentionDays = body.metricsRetentionDays;
    }
    if (typeof body.realTimeWindowDays === 'number') {
      updates.realTimeWindowDays = body.realTimeWindowDays;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updatedPolicy = await updateRetentionPolicy(updates);

    await logAudit({
      action: 'retention.policy.updated',
      entityType: 'USER',
      entityId: session.user.id,
      actorId: session.user.id,
      details: updates,
    });

    logger.info('[API] Retention policy updated', {
      userId: session.user.id,
      updates,
    });

    return NextResponse.json({
      success: true,
      policy: updatedPolicy,
    });
  } catch (error) {
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
    const session = await getServerSession(await getAuthOptions());

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = (session.user as any).role;
    if (userRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const dryRun = body.dryRun !== false; // Default to dry run for safety

    const result = await performDataCleanup(dryRun);

    if (!dryRun) {
      await logAudit({
        action: 'retention.data.purged',
        entityType: 'USER',
        entityId: session.user.id,
        actorId: session.user.id,
        details: JSON.parse(JSON.stringify(result)),
      });
    }

    logger.info('[API] Data cleanup triggered', {
      userId: session.user.id,
      dryRun,
    });

    return NextResponse.json({
      success: true,
      dryRun,
      result,
    });
  } catch (error) {
    logger.error('[API] Failed to perform data cleanup', { error });
    return NextResponse.json({ error: 'Failed to perform cleanup' }, { status: 500 });
  }
}
