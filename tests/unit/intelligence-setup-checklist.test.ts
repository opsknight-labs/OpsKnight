import { describe, expect, it } from 'vitest';
import { OPS_INSIGHT_SWITCHES } from '@/lib/intelligence/ops-insights/contract';
import { setupChecklist, type SetupState } from '@/lib/intelligence/settings/setup-contract';
import {
  INTELLIGENCE_SETTINGS_GROUPS,
  movedIntelligenceSection,
} from '@/lib/intelligence/settings/routes';

const allInsights = (on: boolean) =>
  Object.fromEntries(OPS_INSIGHT_SWITCHES.map(key => [key, on])) as Record<
    (typeof OPS_INSIGHT_SWITCHES)[number],
    boolean
  >;

const state = (overrides: Partial<SetupState> = {}): SetupState => ({
  settings: { enabled: false, revision: 1, ...allInsights(false) },
  policy: { version: 1, mode: 'OFF', triageEnabled: false },
  noise: { revision: 1, mode: 'OFF' },
  squireEnabled: false,
  ...overrides,
});

describe('setupChecklist', () => {
  it('lists every switch family as off on a fresh install, AI outside the preset', () => {
    const items = setupChecklist(state());
    expect(items.map(item => [item.id, item.on, item.inPreset])).toEqual([
      ['engine', false, true],
      ['triage', false, true],
      ['insights', false, true],
      ['noise', false, true],
      ['assistant', false, false],
    ]);
    for (const item of items) expect(item.href).toMatch(/^\/settings\/intelligence/);
  });

  it('counts triage only when enabled in SUGGEST or AUTO, insights only when all are on', () => {
    const shadow = setupChecklist(
      state({ policy: { version: 2, mode: 'SHADOW', triageEnabled: true } })
    );
    expect(shadow.find(item => item.id === 'triage')!.on).toBe(false);
    const on = setupChecklist(
      state({
        settings: { enabled: true, revision: 3, ...allInsights(true) },
        policy: { version: 2, mode: 'SUGGEST', triageEnabled: true },
        noise: { revision: 2, mode: 'SHADOW' },
      })
    );
    expect(on.filter(item => !item.on).map(item => item.id)).toEqual(['assistant']);
    const partial = { ...allInsights(true), [OPS_INSIGHT_SWITCHES[0]]: false };
    expect(
      setupChecklist(state({ settings: { enabled: true, revision: 1, ...partial } })).find(
        item => item.id === 'insights'
      )!.on
    ).toBe(false);
  });
});

describe('moved intelligence settings sections', () => {
  it('sends the old Evaluation #digest link to the Engine page and nothing else', () => {
    expect(movedIntelligenceSection('evaluation', 'digest')).toBe('/settings/intelligence#digest');
    expect(movedIntelligenceSection('evaluation', 'usage')).toBeNull();
    const evaluation = INTELLIGENCE_SETTINGS_GROUPS.find(group => group.id === 'evaluation')!;
    expect(evaluation.sections.map(section => section.id)).not.toContain('digest');
  });
});
