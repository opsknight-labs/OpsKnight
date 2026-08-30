/**
 * Integration Health Check Endpoint
 *
 * GET /api/integrations/health - Get overall integration health
 * GET /api/integrations/health?integrationId=xxx - Get specific integration health
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import {
  getMetricsSummary,
  getMetricsByIntegration,
  serializeMetrics,
} from '@/lib/integrations/metrics';
import { getRateLimitStatus } from '@/lib/integrations/rate-limiter';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { assertCanViewService } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  try {
    // Optional auth check - allow unauthenticated for basic health
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);

    const { searchParams } = new URL(req.url);
    const integrationId = searchParams.get('integrationId');

    // If checking specific integration, require auth
    if (integrationId) {
      if (!session?.user) {
        return jsonError('Unauthorized', 401);
      }

      // Verify integration exists
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        include: {
          service: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!integration) {
        return jsonError('Integration not found', 404);
      }

      try {
        await assertCanViewService(integration.service.id);
      } catch {
        return jsonError('Forbidden', 403);
      }

      const metrics = getMetricsByIntegration(integrationId);
      const rateLimit = getRateLimitStatus(integrationId);

      return jsonOk({
        status: 'ok',
        integration: {
          id: integration.id,
          type: integration.type,
          enabled: integration.enabled,
          service: integration.service,
          createdAt: integration.createdAt.toISOString(),
          updatedAt: integration.updatedAt.toISOString(),
        },
        metrics: serializeMetrics(metrics),
        rateLimit: {
          remaining: rateLimit.remaining,
          resetAt: new Date(rateLimit.resetAt).toISOString(),
        },
      });
    }

    // Global health check
    const summary = getMetricsSummary();

    return jsonOk({
      status: summary.healthStatus,
      global: serializeMetrics(summary.global),
      byType: Object.fromEntries(
        Object.entries(summary.byType).map(([type, metrics]) => [type, serializeMetrics(metrics)])
      ),
      errorRate: summary.errorRate,
    });
  } catch (_error) {
    return jsonError('Internal Server Error', 500);
  }
}

/**
 * POST /api/integrations/health - Test webhook connectivity
 *
 * Accepts a test payload and validates configuration without processing.
 */
export async function POST(req: NextRequest) {
  try {
    const authOptions = await getAuthOptions();
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return jsonError('Unauthorized', 401);
    }

    const { searchParams } = new URL(req.url);
    const integrationId = searchParams.get('integrationId');

    if (!integrationId) {
      return jsonError('integrationId is required', 400);
    }

    // Verify integration exists
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: {
        id: true,
        type: true,
        serviceId: true,
        enabled: true,
      },
    });

    if (!integration) {
      return jsonError('Integration not found', 404);
    }

    try {
      await assertCanViewService(integration.serviceId);
    } catch {
      return jsonError('Forbidden', 403);
    }

    // Parse test payload
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError('Invalid JSON in request body', 400);
    }

    // Validate payload structure based on type
    const { IntegrationSchemas, validatePayload } = await import('@/lib/integrations/schemas');

    const schemaKey = integration.type as keyof typeof IntegrationSchemas;
    // eslint-disable-next-line security/detect-object-injection
    const schema = IntegrationSchemas[schemaKey];

    if (!schema) {
      return jsonOk({
        valid: true,
        integration: {
          id: integration.id,
          type: integration.type,
        },
        message: 'No schema validation available for this integration type',
      });
    }

    // Use any to avoid complex type inference issues
    const validation = validatePayload(schema as any, body); // eslint-disable-line @typescript-eslint/no-explicit-any

    if (!validation.success) {
      return jsonOk(
        {
          valid: false,
          integration: {
            id: integration.id,
            type: integration.type,
          },
          errors: validation.errors,
        },
        200
      ); // Return 200 since this is a validation check, not an error
    }

    return jsonOk({
      valid: true,
      integration: {
        id: integration.id,
        type: integration.type,
      },
      message: 'Payload validation successful',
    });
  } catch (_error) {
    return jsonError('Internal Server Error', 500);
  }
}
