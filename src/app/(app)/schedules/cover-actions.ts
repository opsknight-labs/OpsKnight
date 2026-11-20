'use server';

import { z } from 'zod';
import { assertCanCreateScheduleOverride } from '@/lib/rbac';
import { resolveUserActor } from '@/lib/authorization-actors';
import { logger } from '@/lib/logger';
import { suggestCoverCandidates, type CoverSuggestions } from '@/lib/intelligence/people/cover';

const inputSchema = z.object({
  scheduleId: z.string().min(1).max(64),
  start: z.string().datetime(),
  end: z.string().datetime(),
  replacesUserId: z.string().min(1).max(64).nullable(),
});

/**
 * Ranked cover candidates for the override form. Only people who may create overrides on the schedule
 * get an answer; null whenever nothing should be shown (switch off, bad input, no access, failure).
 */
export async function suggestOverrideCover(input: {
  scheduleId: string;
  start: string;
  end: string;
  replacesUserId: string | null;
}): Promise<CoverSuggestions | null> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const user = await assertCanCreateScheduleOverride(parsed.data.scheduleId);
    const actor = await resolveUserActor(user.id);
    if (!actor) return null;
    return await suggestCoverCandidates(actor, {
      scheduleId: parsed.data.scheduleId,
      start: new Date(parsed.data.start),
      end: new Date(parsed.data.end),
      replacesUserId: parsed.data.replacesUserId,
    });
  } catch (error) {
    logger.warn('intelligence.cover_suggestions.unavailable', {
      scheduleId: parsed.data.scheduleId,
      error,
    });
    return null;
  }
}
