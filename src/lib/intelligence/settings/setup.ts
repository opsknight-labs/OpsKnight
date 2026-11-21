import 'server-only';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { getAiPublicStatus } from '../ai/settings';
import { getNoiseControlPolicy, saveNoiseControlPolicy } from '../noise-controls/manage';
import type { NoiseControlDefinition } from '../noise-controls/contract';
import { OPS_INSIGHT_SWITCHES } from '../ops-insights/contract';
import {
  getIntelligenceSettings,
  publishPolicyVersion,
  resolveEffectivePolicy,
  updateIntelligenceSettings,
  type IntelligenceActor,
} from './service';
import { RECOMMENDED_POLICY_MODES, type SetupRevisions, type SetupState } from './setup-contract';

/** What the setup checklist and the Recommended preset read: four rows, one per switch family. */
export async function getSetupState(): Promise<SetupState> {
  const [settings, policy, noise, ai] = await Promise.all([
    getIntelligenceSettings(),
    resolveEffectivePolicy(null),
    getNoiseControlPolicy(null),
    getAiPublicStatus().catch(() => null),
  ]);
  return {
    settings,
    policy: {
      version: policy.version,
      mode: policy.mode,
      triageEnabled: policy.definition.triage.enabled,
    },
    noise: { revision: noise.revision, mode: noise.mode, detectorsOn: detectorsOn(noise.definition) },
    squireEnabled: ai?.squireEnabled ?? false,
  };
}

const detectorsOn = (definition: NoiseControlDefinition) =>
  definition.contentDedup.enabled || definition.flapping.enabled || definition.storm.enabled;

/**
 * The Recommended preset: turns on the engine, every operations-insight area, the small helpers, triage
 * suggestions (global policy SUGGEST when it was OFF or SHADOW) and global noise controls in SHADOW with
 * dedup, flapping and storm grouping enabled when they were OFF (or SHADOW recording nothing). It never
 * lowers anything, never sets AUTO or noise ON (nothing that changes who is paged) and never touches AI.
 * Each write goes through its own service, so revision checks and audit entries are the usual ones; the
 * engine settings and the policy commit together, the noise policy (its own service and transaction) after.
 * `expected` is what the page showed: any change since then fails with PRECONDITION_FAILED.
 *
 * Caller must authorize INTELLIGENCE_MANAGE. Returns the switches it changed.
 */
export async function applyRecommendedPreset(
  expected: SetupRevisions,
  actor: IntelligenceActor
): Promise<string[]> {
  // The noise policy saves in its own transaction after the rest: check it first so a stale page changes
  // nothing. shortcut: an edit landing between this read and the save still fails after the commit.
  const noise = await getNoiseControlPolicy(null);
  if (noise.revision !== expected.noiseRevision)
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  const changed = await prisma.$transaction(async tx => {
    const done: string[] = [];
    const { revision, ...settings } = await getIntelligenceSettings(tx);
    if (revision !== expected.settingsRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const presetKeys = ['enabled' as const, 'opsHelpersEnabled' as const, ...OPS_INSIGHT_SWITCHES];
    // eslint-disable-next-line security/detect-object-injection -- keys come from the fixed list above
    const switches = presetKeys.filter(key => !settings[key]);
    if (switches.length > 0) {
      await updateIntelligenceSettings(
        {
          ...settings,
          ...Object.fromEntries(switches.map(key => [key, true])),
          expectedRevision: revision,
        },
        actor,
        tx
      );
      done.push(...switches);
    }
    const policy = await resolveEffectivePolicy(null, tx);
    if (policy.version !== expected.policyVersion)
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    const mode = RECOMMENDED_POLICY_MODES.includes(policy.mode) ? 'SUGGEST' : policy.mode;
    if (mode !== policy.mode || !policy.definition.triage.enabled) {
      await publishPolicyVersion(
        {},
        {
          mode,
          definition: { ...policy.definition, triage: { enabled: true } },
          reason: 'Recommended setup: triage suggestions',
          expectedHeadVersion: policy.version,
        },
        actor,
        tx
      );
      done.push('triageSuggestions');
    }
    return done;
  });

  // Shadow never pages differently, so its detectors are safe to enable; without them it records nothing.
  if (noise.mode === 'OFF' || (noise.mode === 'SHADOW' && !detectorsOn(noise.definition))) {
    const { contentDedup, flapping, storm } = noise.definition;
    await saveNoiseControlPolicy(
      {
        serviceId: null,
        mode: 'SHADOW',
        definition: {
          ...noise.definition,
          contentDedup: { ...contentDedup, enabled: true },
          flapping: { ...flapping, enabled: true },
          storm: { ...storm, enabled: true },
        },
        expectedRevision: expected.noiseRevision,
      },
      actor
    );
    changed.push('noiseShadow');
  }
  return changed;
}
