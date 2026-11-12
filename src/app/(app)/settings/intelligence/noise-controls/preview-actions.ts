'use server';

import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import {
  previewMaintenanceWindow,
  previewMatchers,
  previewOrchestrationRules,
  previewSuppressionRule,
  type MatchPreview,
  type WindowPreview,
} from '@/lib/intelligence/noise-controls/preview';
import type { SimulationOutcome } from '@/lib/intelligence/noise-controls';

/**
 * Read-only previews for the noise-control builders. Saving stays with `./actions.ts`; these only
 * replay history. Managers only, like the existing "Test against history" simulation.
 */

export type PreviewResult<T> = { ok: true; data: T } | { ok: false; message: string };

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return {
      ok: false,
      message: detail ? `${error.userMessage} (${detail.message})` : error.userMessage,
    };
  }
  logger.error('[Intelligence] Noise control preview failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { ok: false, message: 'The preview could not run. Try again shortly.' };
}

export async function previewMatchersAction(input: unknown): Promise<PreviewResult<MatchPreview>> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    return { ok: true, data: await previewMatchers(await getIntelligenceSettings(), input) };
  } catch (error) {
    return failure(error);
  }
}

export async function previewWindowAction(input: unknown): Promise<PreviewResult<WindowPreview>> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    return {
      ok: true,
      data: await previewMaintenanceWindow(await getIntelligenceSettings(), input, user.id),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function previewRuleAction(input: unknown): Promise<PreviewResult<SimulationOutcome>> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    return {
      ok: true,
      data: await previewSuppressionRule(await getIntelligenceSettings(), input, user.id),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function previewOrchestrationAction(
  input: unknown
): Promise<PreviewResult<SimulationOutcome>> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    return {
      ok: true,
      data: await previewOrchestrationRules(await getIntelligenceSettings(), input, user.id),
    };
  } catch (error) {
    return failure(error);
  }
}
