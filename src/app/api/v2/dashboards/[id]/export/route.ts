import { createHash } from 'node:crypto';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { DashboardIdV2Schema } from '@/lib/api-v2/dashboards';
import { DashboardDataQueryV2Schema, readDashboardData } from '@/lib/api-v2/dashboard-data';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';

const MAX_DASHBOARD_EXPORT_BYTES = 256 * 1024;

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: DashboardIdV2Schema,
  querySchema: DashboardDataQueryV2Schema,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, apiKey, params, query, rateLimitHeaders }) => {
    const snapshot = await readDashboardData(actor, params.id, query);
    const bytes = Buffer.from(JSON.stringify(snapshot));
    if (bytes.length > MAX_DASHBOARD_EXPORT_BYTES)
      throw new AppError({ code: 'PAYLOAD_TOO_LARGE' });
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await prisma.$transaction(tx => logV2Audit({
      action: 'dashboard.export.downloaded',
      entityType: 'DASHBOARD',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { checksum, sizeBytes: bytes.length, windowDays: snapshot.windowDays },
      tx,
    }));
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...rateLimitHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="opsknight-dashboard.json"',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-SHA256': checksum,
      },
    });
  },
});
