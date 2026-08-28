import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertAdmin } from '@/lib/rbac';

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Create default status page if it doesn't exist
 * POST /api/status/create-default
 */
export async function POST() {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      try {
        await assertAdmin();
      } catch (error) {
        if (isAppError(error)) return jsonError(error);
        return jsonError('Unauthorized. Admin access required.', 403);
      }
    }

    // Check if status page exists
    const existing = await prisma.statusPage.findFirst({});

    if (existing) {
      return jsonOk(
        {
          success: true,
          message: 'Status page already exists',
          id: existing.id,
        },
        200
      );
    }

    // Create default status page
    const statusPage = await prisma.statusPage.create({
      data: {
        name: 'Status Page',
        enabled: true,
        showServices: true,
        showIncidents: true,
        showMetrics: true,
      },
    });

    return jsonOk(
      {
        success: true,
        message: 'Default status page created',
        id: statusPage.id,
      },
      200
    );
  } catch (error: unknown) {
    logger.error('api.status.create_default_error', {
      error: error instanceof Error ? error.message : String(error),
      errorCode: errorCode(error),
    });

    // PostgreSQL undefined-table and Prisma missing-table errors are structured.
    // Do not infer deployment state from exception wording.
    const code = errorCode(error);
    if (code === '42P01' || code === 'P2021') {
      return NextResponse.json(
        {
          error: 'Database tables not found. Please run: npx prisma db push',
          code: 'MIGRATION_NEEDED',
        },
        { status: 500 }
      );
    }

    return jsonError('Failed to create status page', 500);
  }
}
