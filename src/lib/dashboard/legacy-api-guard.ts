import type { NextResponse } from 'next/server';
import { jsonApiError, jsonError } from '@/lib/api-response';
import { CAPABILITIES } from '@/lib/authorization';
import { checkRateLimit } from '@/lib/rate-limit';
import { assertCapability } from '@/lib/rbac';

/**
 * Gate for the legacy /api/dashboards routes: report.read to read and report.manage to create,
 * change or delete, plus a per-user rate limit. Returns the response to send, or the acting user id.
 */
export async function guardLegacyDashboardApi(
  access: 'read' | 'write'
): Promise<{ response: NextResponse } | { userId: string }> {
  let userId: string;
  try {
    userId = (
      await assertCapability(access === 'write' ? CAPABILITIES.REPORT_MANAGE : CAPABILITIES.REPORT_READ)
    ).id;
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
