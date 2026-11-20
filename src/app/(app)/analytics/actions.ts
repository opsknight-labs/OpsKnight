'use server';

import { z } from 'zod';
import { invalidateAnalyticsCache, parseAnalyticsParams } from '@/lib/analytics';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';

/** Drops this actor's cached analytics for the given filters so the next render recomputes. */
export async function refreshAnalytics(search: string): Promise<void> {
  await assertCapability(CAPABILITIES.REPORT_READ);
  const query = z.string().max(4000).parse(search);
  const actor = await getCurrentAuthorizationActor();
  invalidateAnalyticsCache(actor, parseAnalyticsParams(new URLSearchParams(query)));
}
