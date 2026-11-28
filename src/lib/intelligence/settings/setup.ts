import 'server-only';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import {
  getAiPublicStatus,
  getAiSettings,
  listAiProviders,
  saveAiProvider,
  updateAiSettings,
} from '../ai/settings';
import {
  assessNoiseReadiness,
  getNoiseControlPolicy,
  saveNoiseControlPolicy,
} from '../noise-controls/manage';
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
  const [settings, policy, noise, ai, providers] = await Promise.all([
    getIntelligenceSettings(),
    resolveEffectivePolicy(null),
    getNoiseControlPolicy(null),
    getAiPublicStatus().catch(() => null),
    listAiProviders().catch(() => []),
  ]);
  return {
    settings,
    policy: {
      version: policy.version,
      mode: policy.mode,
      triageEnabled: policy.definition.triage.enabled,
    },
    noise: {
      revision: noise.revision,
      mode: noise.mode,
      detectorsOn: detectorsOn(noise.definition),
    },
    squireEnabled: ai?.squireEnabled ?? false,
    aiConfigured: Boolean(ai?.aiEnabled) && providers.some(provider => provider.enabled),
  };
}

const detectorsOn = (definition: NoiseControlDefinition) =>
  definition.contentDedup.enabled && definition.flapping.enabled && definition.storm.enabled;

/**
 * The Recommended preset ("Start watching"): turns on the engine, every operations-insight area, the small
 * helpers, triage collection (global policy SHADOW when it was OFF; responders see nothing new) and global noise controls in SHADOW with
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
    // Watch only: the engine learns and records, and responders see nothing new until the person switches on.
    const mode = RECOMMENDED_POLICY_MODES.includes(policy.mode) ? 'SHADOW' : policy.mode;
    if (mode !== policy.mode || !policy.definition.triage.enabled) {
      await publishPolicyVersion(
        {},
        {
          mode,
          definition: { ...policy.definition, triage: { enabled: true } },
          reason: 'Recommended setup: start watching',
          expectedHeadVersion: policy.version,
        },
        actor,
        tx
      );
      done.push('triageWatching');
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

/**
 * "Switch on": after the watching period, show suggestions to the team (global policy SUGGEST) and, only when
 * the watching evidence is enough (`assessNoiseReadiness`), turn noise controls ON so they are applied before
 * anyone is paged. Suggestions alone never change who is paged; noise ON does, which is why it waits for
 * evidence and is never forced here. Never sets AUTO and never lowers anything. Same revision checks and audit
 * as the preset.
 *
 * Caller must authorize INTELLIGENCE_MANAGE. Returns what it changed: `suggestions`, `noiseOn`.
 */
export async function switchOnSuggestions(
  expected: SetupRevisions,
  actor: IntelligenceActor
): Promise<string[]> {
  const noise = await getNoiseControlPolicy(null);
  if (noise.revision !== expected.noiseRevision)
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  const done: string[] = [];
  await prisma.$transaction(async tx => {
    const settings = await getIntelligenceSettings(tx);
    if (!settings.enabled) return;
    if (settings.revision !== expected.settingsRevision)
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    const policy = await resolveEffectivePolicy(null, tx);
    if (policy.version !== expected.policyVersion)
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    if (policy.mode === 'OFF' || policy.mode === 'SHADOW') {
      await publishPolicyVersion(
        {},
        {
          mode: 'SUGGEST',
          definition: { ...policy.definition, triage: { enabled: true } },
          reason: 'Switched on: show suggestions to the team',
          expectedHeadVersion: policy.version,
        },
        actor,
        tx
      );
      done.push('suggestions');
    }
  });
  if (noise.mode === 'SHADOW' && (await assessNoiseReadiness(null)).ready) {
    await saveNoiseControlPolicy(
      {
        serviceId: null,
        mode: 'ON',
        definition: noise.definition,
        expectedRevision: expected.noiseRevision,
      },
      actor
    );
    done.push('noiseOn');
  }
  return done;
}

/** The three providers the guided setup offers, with a model that works out of the box. Others: Assistant settings. */
export const SETUP_AI_PROVIDERS = {
  ANTHROPIC: { label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5' },
  OPENAI: { label: 'OpenAI', model: 'gpt-5' },
  GOOGLE: { label: 'Google (Gemini)', model: 'gemini-2.5-pro' },
} as const;
export type SetupAiKind = keyof typeof SETUP_AI_PROVIDERS;

/**
 * Guided setup, "Add an AI model": stores one external provider (one entry per kind, so trying again updates it
 * instead of adding another) and switches AI on. `incidentText` chooses what the model may read: incident text
 * and names (Personal, which summaries and drafts need) or only titles and service names (Internal). Nothing
 * else about AI changes, and the key is stored encrypted and never returned.
 *
 * Caller must authorize INTELLIGENCE_MANAGE. Returns the provider id, so the caller can test the connection.
 */
export async function addAiModel(
  input: { kind: SetupAiKind; apiKey: string; model?: string; incidentText: boolean },
  actor: IntelligenceActor
): Promise<string> {
  const defaults = SETUP_AI_PROVIDERS[input.kind];
  const name = `${defaults.label} (setup)`;
  const existing = (await listAiProviders()).find(provider => provider.name === name);
  const provider = await saveAiProvider(
    existing?.id ?? null,
    {
      name,
      kind: input.kind,
      model: input.model?.trim() || defaults.model,
      baseUrl: null,
      apiKey: input.apiKey,
      enabled: true,
      isExternal: true,
      maxDataClass: input.incidentText ? 'PERSONAL' : 'INTERNAL',
      allowPrivateNetwork: false,
      priority: existing?.priority ?? 1,
      dataRegion: null,
      embeddingModel: null,
    },
    actor
  );
  const current = await getAiSettings();
  if (!current.enabled) {
    await updateAiSettings(
      {
        enabled: true,
        squireEnabled: current.squireEnabled,
        squireName: current.squireName,
        squireLauncher: current.squireLauncher,
        squireAnimations: current.squireAnimations,
        allowExternalFallback: current.allowExternalFallback,
        requestsPerMinutePerUser: current.requestsPerMinutePerUser,
        dailyTokenBudget: current.dailyTokenBudget,
        backgroundEmbeddingBudgetPercent: current.backgroundEmbeddingBudgetPercent,
        userDailyTokenBudget: current.userDailyTokenBudget,
        maxOutputTokens: current.maxOutputTokens,
        requestTimeoutMs: current.requestTimeoutMs,
        allowedDataRegions: current.allowedDataRegions,
        embeddingsEnabled: current.embeddingsEnabled,
        squireHistoryEnabled: current.squireHistoryEnabled,
        squireHistoryRetentionDays: current.squireHistoryRetentionDays,
        expectedRevision: current.revision,
      },
      actor
    );
  }
  return provider.id;
}
