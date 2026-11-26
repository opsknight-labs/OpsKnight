import type { NextResponse } from 'next/server';
import { jsonApiError, jsonError } from '@/lib/api-response';
import { CAPABILITIES } from '@/lib/authorization';
import { checkRateLimit } from '@/lib/rate-limit';
import { assertCapability } from '@/lib/rbac';

/**
 * Gate for the legacy /api/dashboards routes: the same report.read requirement as the /reports
 * pages, plus a per-user rate limit. Returns the response to send, or the acting user id.
 */
export async function guardLegacyDashboardApi(
  access: 'read' | 'write'
): Promise<{ response: NextResponse } | { userId: string }> {
  let userId: string;
  try {
    userId = (await assertCapability(CAPABILITIES.REPORT_READ)).id;
  } catch (error) {
    return { response: jsonApiError(error) };
  }
  const rate = await checkRateLimit(
    `api:dashboards:${access}:${userId}`,
    access === 'write' ? 30 : 120,
    60_000
  );
  if (!rate.allowed) {
    return {
      response: jsonError('Rate limit exceeded', 429, {
        retryAfter: Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)),
      }),
    };
  }
  return { userId };
}
