import type { NextRequest } from 'next/server';
import { createAnalyticsContext, parseAnalyticsParams } from '@/lib/analytics';
import { drillInputSchema, queryDrilldown } from '@/lib/analytics/drilldown';
import { jsonApiError, jsonApiOk, jsonError } from '@/lib/api-response';
import { CAPABILITIES } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

/** The incidents behind an analytics number, for the page's drill-down sheet. */
export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof assertCapability>>;
  let actor: Awaited<ReturnType<typeof getCurrentAuthorizationActor>>;
  try {
    // Same requirement as the /analytics page (REPORT_READ).
    user = await assertCapability(CAPABILITIES.REPORT_READ);
    actor = await getCurrentAuthorizationActor();
  } catch (error) {
    return jsonApiError(error);
  }

  const search = request.nextUrl.searchParams;
  const input = drillInputSchema.safeParse({
    drill: search.get('drill') ?? undefined,
    serviceId: search.get('serviceId') ?? undefined,
    cursor: search.get('cursor') ?? undefined,
  });
  if (!input.success) return jsonError('Invalid drill-down request', 400);

  try {
    const context = await createAnalyticsContext(
      actor,
      parseAnalyticsParams(search),
      getUserTimeZone(user)
    );
    const page = await queryDrilldown(context.scope, context.window, input.data);
    return jsonApiOk(page, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logger.error('analytics.drilldown_failed', { error });
    return jsonApiError(error);
  }
}
