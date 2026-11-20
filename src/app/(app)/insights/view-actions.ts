'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  createAnalyticsView,
  deleteAnalyticsView,
  listAnalyticsViews,
  renameAnalyticsView,
  setAnalyticsViewWeeklyEmail,
  setDefaultAnalyticsView,
  type AnalyticsViewSummary,
} from '@/lib/analytics/views';

export type ViewActionResult = { ok: true; query?: string } | { ok: false; error: string };

async function run(work: () => Promise<string | void>): Promise<ViewActionResult> {
  try {
    const query = await work();
    revalidatePath('/insights');
    return { ok: true, ...(query !== undefined ? { query } : {}) };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.userMessage };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? 'Check the view details.' };
    }
    logger.error('[Analytics views] Action failed', { error });
    return { ok: false, error: 'Unable to update views. Refresh and try again.' };
  }
}

export async function listAnalyticsViewsAction(): Promise<AnalyticsViewSummary[]> {
  return listAnalyticsViews(await getCurrentAuthorizationActor());
}

export async function createAnalyticsViewAction(input: {
  name: string;
  query: string;
  visibility: 'PRIVATE' | 'TEAM';
  teamId?: string | null;
}) {
  return run(async () => {
    const view = await createAnalyticsView(await getCurrentAuthorizationActor(), input);
    return view.query;
  });
}

export async function renameAnalyticsViewAction(id: string, name: string) {
  return run(async () => renameAnalyticsView(await getCurrentAuthorizationActor(), id, name));
}

export async function deleteAnalyticsViewAction(id: string) {
  return run(async () => deleteAnalyticsView(await getCurrentAuthorizationActor(), id));
}

export async function setDefaultAnalyticsViewAction(id: string | null) {
  return run(async () => setDefaultAnalyticsView(await getCurrentAuthorizationActor(), id));
}

export async function setAnalyticsViewWeeklyEmailAction(id: string, enabled: boolean) {
  return run(async () =>
    setAnalyticsViewWeeklyEmail(await getCurrentAuthorizationActor(), id, enabled)
  );
}
