/**
 * The Intelligence setup checklist: which switches are off, what each gives and where to turn it on. Pure
 * and dependency-free so the page, the action and tests share it.
 */
import type { IntelligenceModeValue } from '@/lib/intelligence/contract';
import {
  OPS_INSIGHT_SWITCHES,
  type OpsInsightSwitch,
} from '@/lib/intelligence/ops-insights/contract';
import { intelligenceSettingsHref } from './routes';

/** Global policy modes the preset raises to Watch only (SHADOW); SHADOW, SUGGEST and AUTO are left alone. */
export const RECOMMENDED_POLICY_MODES: readonly IntelligenceModeValue[] = ['OFF'];

/**
 * Where an installation is on the way to value, in words a newcomer can use:
 * off (nothing runs), learning (watching, nobody sees or feels anything), showing (responders see suggestions),
 * acting (noise controls are applied before anyone is paged).
 */
export type SetupStage = 'off' | 'learning' | 'showing' | 'acting';

export interface SetupState {
  settings: { enabled: boolean; revision: number; opsHelpersEnabled: boolean } & Record<
    OpsInsightSwitch,
    boolean
  >;
  policy: { version: number; mode: IntelligenceModeValue; triageEnabled: boolean };
  /** `detectorsOn`: dedup, flapping and storm grouping are all enabled, as the Recommended preset sets them. */
  noise: { revision: number; mode: 'OFF' | 'SHADOW' | 'ON'; detectorsOn: boolean };
  squireEnabled: boolean;
  /** AI is switched on and at least one provider is enabled. Squire answers without it, from incident data. */
  aiConfigured: boolean;
}

export interface SetupRevisions {
  settingsRevision: number;
  policyVersion: number;
  noiseRevision: number;
}

export interface SetupChecklistItem {
  id: 'engine' | 'triage' | 'insights' | 'helpers' | 'noise' | 'assistant';
  label: string;
  /** What turning it on gives, in one sentence. */
  benefit: string;
  on: boolean;
  /** Where to turn it on by hand. */
  href: string;
  /** Whether the Recommended preset turns it on. */
  inPreset: boolean;
}

export function setupStage(state: SetupState): SetupStage {
  if (!state.settings.enabled) return 'off';
  if (state.noise.mode === 'ON') return 'acting';
  if (state.policy.mode === 'SUGGEST' || state.policy.mode === 'AUTO') return 'showing';
  return 'learning';
}

export function setupRevisions(state: SetupState): SetupRevisions {
  return {
    settingsRevision: state.settings.revision,
    policyVersion: state.policy.version,
    noiseRevision: state.noise.revision,
  };
}

export function setupChecklist(state: SetupState): SetupChecklistItem[] {
  return [
    {
      id: 'engine',
      label: 'Intelligence engine',
      benefit: 'Finds similar past incidents, related incidents and possible causes, without AI.',
      on: state.settings.enabled,
      href: intelligenceSettingsHref('engine', 'general'),
      inPreset: true,
    },
    {
      id: 'triage',
      label: 'Suggestions for your team',
      benefit:
        'Shows responders similar incidents, likely causes and triage hints; a person always decides. Switched on after the watching period.',
      on:
        state.policy.triageEnabled &&
        (state.policy.mode === 'SUGGEST' || state.policy.mode === 'AUTO'),
      href: intelligenceSettingsHref('engine', 'triage'),
      // The preset only watches; showing suggestions to responders is the person's choice (see switchOnSuggestions).
      inPreset: false,
    },
    {
      id: 'insights',
      label: 'Operations insights',
      benefit:
        'Points out silent integrations, noisy policies, overloaded schedules and failing runbooks.',
      // eslint-disable-next-line security/detect-object-injection -- keys come from the fixed OPS_INSIGHT_SWITCHES list
      on: OPS_INSIGHT_SWITCHES.every(key => state.settings[key]),
      href: intelligenceSettingsHref('engine', 'operations-insights'),
      inPreset: true,
    },
    {
      id: 'helpers',
      label: 'Small helpers',
      benefit:
        'Suggests a service, urgency and a likely duplicate while someone creates an incident, and similar deterministic hints.',
      on: state.settings.opsHelpersEnabled,
      href: intelligenceSettingsHref('engine', 'general'),
      inPreset: true,
    },
    {
      id: 'noise',
      label: 'Noise controls, watching',
      benefit:
        'Records what merging repeats, quieting flapping alerts and grouping storms would hold back, without changing any page.',
      // Shadow with every detector off records nothing, so it is not on yet.
      on: state.noise.mode === 'ON' || (state.noise.mode === 'SHADOW' && state.noise.detectorsOn),
      href: intelligenceSettingsHref('noise', 'policy'),
      inPreset: true,
    },
    {
      id: 'assistant',
      label: 'AI model for Squire',
      benefit:
        'Lets Squire write summaries and answer in full sentences. Without a model it still answers from your incident data. Not part of the preset.',
      on: state.squireEnabled && state.aiConfigured,
      href: intelligenceSettingsHref('assistant', 'assistant'),
      inPreset: false,
    },
  ];
}
