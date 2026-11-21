import 'server-only';
import { logger } from '@/lib/logger';
import type { CorrelationRule } from '../contract';
import {
  getIntelligenceSettings,
  publishPolicyVersion,
  resolveEffectivePolicy,
  type IntelligenceActor,
} from './service';

export const SHADOW_DEFAULT_TEMPLATE_RULE: CorrelationRule = {
  id: 'template',
  kind: 'CONTENT_TEMPLATE',
  enabled: true,
  keys: [],
  windowSeconds: 300,
  maxWindowSeconds: 900,
  minScore: 0.8,
};

/**
 * A new service starts measuring grouping: a per-service policy with one content-template rule in SHADOW,
 * so the quality page has evidence by the time someone considers turning it on. Only while the global
 * intelligence switch is on, and never over a global policy that already suggests or acts (a SHADOW
 * override would downgrade the new service). Best effort: creating the service never fails on it.
 */
export async function seedShadowServicePolicy(
  serviceId: string,
  actor: IntelligenceActor
): Promise<boolean> {
  try {
    if (!(await getIntelligenceSettings()).enabled) return false;
    const current = await resolveEffectivePolicy(serviceId);
    if (current.source === 'service' || current.mode === 'SUGGEST' || current.mode === 'AUTO')
      return false;
    await publishPolicyVersion(
      { serviceId },
      {
        mode: 'SHADOW',
        expectedHeadVersion: 0,
        definition: {
          ...current.definition,
          correlation: { ...current.definition.correlation, rules: [SHADOW_DEFAULT_TEMPLATE_RULE] },
        },
        reason: 'New-service default: one content-template grouping rule, measured in SHADOW.',
      },
      actor
    );
    return true;
  } catch (error) {
    logger.warn('[Intelligence] New-service SHADOW policy was not created', {
      serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
