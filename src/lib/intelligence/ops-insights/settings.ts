import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  getIntelligenceSettings,
  updateIntelligenceSettings,
  type IntelligenceActor,
  type IntelligenceSettingsView,
} from '../settings/service';

const switchesSchema = z
  .object({
    opsInsightsEnabled: z.boolean(),
    opsInsightsAutomationEnabled: z.boolean(),
    opsInsightsEscalationEnabled: z.boolean(),
    opsInsightsOnCallEnabled: z.boolean(),
    opsInsightsPostmortemsEnabled: z.boolean(),
    opsInsightsRunbooksEnabled: z.boolean(),
    opsInsightsNotificationsEnabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Saves the operations-insight switches only. Goes through the one settings writer, so the revision check
 * and the audit entry are the same as for every other Intelligence setting. Caller must authorize
 * INTELLIGENCE_MANAGE.
 */
export async function updateOpsInsightSwitches(
  input: unknown,
  actor: IntelligenceActor
): Promise<IntelligenceSettingsView> {
  const parsed = switchesSchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: 'VALIDATION_FAILED' });
  return prisma.$transaction(async tx => {
    const { revision: _revision, ...current } = await getIntelligenceSettings(tx);
    return updateIntelligenceSettings({ ...current, ...parsed.data }, actor, tx);
  });
}
