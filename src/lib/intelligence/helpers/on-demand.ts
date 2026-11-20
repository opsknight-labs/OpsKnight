import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { registerAiGateway } from '../ai/gateway';
import { outputTokensFor, type AiFeature } from '../ai/output-limits';
import { resolveLanguageModel, type AiCapability } from '../ai/port';
import { redactSecrets } from '../ai/redact';
import { cachedGenerate } from '../ai/result-cache';
import { getAiSettings } from '../ai/settings';
import { getIntelligenceSettings } from '../settings/service';

/** What an on-demand helper answers: the deterministic text always, the model's phrasing when there is one. */
export interface OnDemandDetail {
  detail: string;
  phrasing: string | null;
}

/** The small-helpers switch (off by default) that every on-demand helper sits behind. */
export async function opsHelpersOn(): Promise<boolean> {
  const settings = await getIntelligenceSettings();
  return settings.enabled && settings.opsHelpersEnabled;
}

/**
 * One interactive, cached model call that rewrites `facts` under `instruction`. Null when AI is off, no
 * provider is cleared for internal data, or anything fails: callers then show their deterministic text.
 */
export async function phraseOnDemand(
  actor: AuthorizationActor,
  input: {
    feature: AiFeature;
    capability: AiCapability;
    prompt: { id: string; version: number };
    instruction: string;
    facts: string;
    scope?: string;
  }
): Promise<string | null> {
  try {
    if (!(await getAiSettings()).enabled) return null;
    registerAiGateway();
    const port = await resolveLanguageModel(input.capability, 'INTERNAL');
    if (!port) return null;
    const result = await cachedGenerate(
      port,
      {
        context: {
          actorId: actor.id,
          capability: input.capability,
          callSite: 'interactive',
          dataClass: 'INTERNAL',
        },
        messages: [
          { role: 'system', content: input.instruction, dataClass: 'INTERNAL' },
          { role: 'user', content: input.facts, dataClass: 'INTERNAL' },
        ],
        maxOutputTokens: outputTokensFor(input.feature),
      },
      { prompt: input.prompt, ...(input.scope ? { scope: input.scope } : {}) }
    );
    return redactSecrets(result.text.trim()).slice(0, 1_200) || null;
  } catch {
    return null;
  }
}
