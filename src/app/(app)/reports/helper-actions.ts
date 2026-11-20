'use server';

import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { weeklyNarrative } from '@/lib/intelligence/helpers/reports-narrative';
import type { OnDemandDetail } from '@/lib/intelligence/helpers/on-demand';

/** The reports page's weekly paragraph for the signed-in viewer; null when off, empty or on any failure. */
export async function weeklyNarrativeAction(): Promise<OnDemandDetail | null> {
  try {
    return await weeklyNarrative(await getCurrentAuthorizationActor());
  } catch {
    return null;
  }
}
