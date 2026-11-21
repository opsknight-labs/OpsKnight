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

/** Global policy modes the preset raises to SUGGEST; SUGGEST and AUTO are left alone. */
export const RECOMMENDED_POLICY_MODES: readonly IntelligenceModeValue[] = ['OFF', 'SHADOW'];

export interface SetupState {
  settings: { enabled: boolean; revision: number } & Record<OpsInsightSwitch, boolean>;
  policy: { version: number; mode: IntelligenceModeValue; triageEnabled: boolean };
  noise: { revision: number; mode: 'OFF' | 'SHADOW' | 'ON' };
  squireEnabled: boolean;
}

export interface SetupRevisions {
  settingsRevision: number;
  policyVersion: number;
  noiseRevision: number;
}

export interface SetupChecklistItem {
  id: 'engine' | 'triage' | 'insights' | 'noise' | 'assistant';
  label: string;
  /** What turning it on gives, in one sentence. */
  benefit: string;
  on: boolean;
  /** Where to turn it on by hand. */
  href: string;
  /** Whether the Recommended preset turns it on. */
  inPreset: boolean;
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
      label: 'Triage suggestions',
      benefit:
        'Suggests urgency, owner and duplicates from similar resolved incidents; a responder decides.',
      on:
        state.policy.triageEnabled &&
        (state.policy.mode === 'SUGGEST' || state.policy.mode === 'AUTO'),
      href: intelligenceSettingsHref('engine', 'triage'),
      inPreset: true,
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
      id: 'noise',
      label: 'Noise controls in shadow',
      benefit: 'Records what suppression and grouping would hold back, without changing any page.',
      on: state.noise.mode !== 'OFF',
      href: intelligenceSettingsHref('noise', 'policy'),
      inPreset: true,
    },
    {
      id: 'assistant',
      label: 'Squire assistant',
      benefit:
        'Answers questions about incidents with an AI model you choose. Not part of the preset.',
      on: state.squireEnabled,
      href: intelligenceSettingsHref('assistant', 'assistant'),
      inPreset: false,
    },
  ];
}
