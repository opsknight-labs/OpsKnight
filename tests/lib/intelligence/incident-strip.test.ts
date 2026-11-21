import { beforeEach, describe, expect, it, vi } from 'vitest';

const views = vi.hoisted(() => ({
  policy: vi.fn(),
  analysis: vi.fn(),
  similar: vi.fn(),
  related: vi.fn(),
  response: vi.fn(),
  triage: vi.fn(),
  impact: vi.fn(),
  proactive: vi.fn(),
  group: vi.fn(),
  badges: vi.fn(),
  axis: vi.fn(),
  ai: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: views.warn, debug: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: vi.fn() }));
vi.mock('@/lib/intelligence/settings/service', () => ({
  resolveEffectivePolicy: views.policy,
  resolveEffectivePolicyForRequest: views.policy,
}));
vi.mock('@/lib/intelligence/ai/settings', () => ({ getAiPublicStatus: views.ai }));
vi.mock('@/lib/intelligence/analysis/view', () => ({ readIncidentAnalysisState: views.analysis }));
vi.mock('@/lib/intelligence/similarity/view', () => ({
  getSimilarIncidentsForActor: views.similar,
}));
vi.mock('@/lib/intelligence/correlation/view', () => ({
  getRelatedIncidentsForActor: views.related,
}));
vi.mock('@/lib/intelligence/response/view', () => ({
  getResponseIntelligenceForActor: views.response,
}));
vi.mock('@/lib/intelligence/triage/view', () => ({ getTriageForActor: views.triage }));
vi.mock('@/lib/intelligence/impact/view', async () => ({
  getIncidentImpactForActor: views.impact,
  isImpactEmpty: (
    await vi.importActual<typeof import('@/lib/intelligence/impact/view')>(
      '@/lib/intelligence/impact/view'
    )
  ).isImpactEmpty,
}));
vi.mock('@/lib/intelligence/memory/proactive-view', () => ({
  getProactiveNotesForActor: views.proactive,
}));
vi.mock('@/lib/intelligence/timeline/service', () => ({
  getIncidentTimeAxisForActor: views.axis,
}));
vi.mock('@/lib/intelligence/incident-ux/group-view', () => ({
  getIncidentGroupForActor: views.group,
}));
vi.mock('@/lib/intelligence/incident-ux/list-badges', () => ({
  getIncidentListBadges: views.badges,
}));

import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  buildStripChips,
  insightsSections,
  loadIncidentInsights,
  showsFreshnessDot,
} from '@/lib/intelligence/incident-ux/strip';
import { isInsightsSection } from '@/lib/intelligence/incident-ux/strip-contract';
import { busyInsights, quietInsights } from '../../helpers/incident-insights-fixture';

const actor = (role: 'ADMIN' | 'RESPONDER' | 'USER') =>
  ({ userId: 'u1', role, status: 'ACTIVE', teamIds: [] }) as unknown as AuthorizationActor;

const client = {
  incident: { findFirst: vi.fn() },
} as unknown as NonNullable<Parameters<typeof loadIncidentInsights>[2]>['client'];

const busy = busyInsights();

beforeEach(() => {
  vi.clearAllMocks();
  (client!.incident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ serviceId: 'svc' });
  views.policy.mockResolvedValue({ effectiveMode: 'SUGGEST' });
  views.analysis.mockResolvedValue(busy.analysis);
  views.similar.mockResolvedValue(busy.similar);
  views.related.mockResolvedValue(busy.related);
  views.response.mockResolvedValue(busy.response);
  views.triage.mockResolvedValue(busy.triage);
  views.impact.mockResolvedValue(busy.impact);
  views.proactive.mockResolvedValue(busy.proactive);
  views.group.mockResolvedValue(busy.group);
  views.badges.mockResolvedValue({
    'inc-1': [
      { kind: 'suppressed', label: 'Suppressed by Known noisy probe' },
      { kind: 'parent', count: 2 },
    ],
  });
  views.ai.mockResolvedValue({
    aiEnabled: true,
    squireEnabled: true,
    mobileEnabled: false,
    squireName: 'Pip',
  });
});

describe('buildStripChips', () => {
  it('renders no chip for an incident with nothing to say', () => {
    expect(buildStripChips(quietInsights())).toEqual([]);
    expect(insightsSections(quietInsights())).toEqual([]);
  });

  it('builds one chip per fact that has content, in a fixed order', () => {
    expect(buildStripChips(busy).map(chip => [chip.id, chip.label])).toEqual([
      ['triage', 'Triage: urgency HIGH · Team Payments'],
      ['similar', '1 similar'],
      ['why', 'Likely cause: deploy api v9'],
      ['noise-suppressed', 'Suppressed by Known noisy probe'],
      ['impact', 'Impact: 2 services, SLO burning'],
      ['briefing', 'Briefing ready'],
    ]);
  });

  it('states the storm group once, in the hero line, never as a chip', () => {
    expect(buildStripChips(busy).some(chip => /group|parent/i.test(chip.label))).toBe(false);
  });

  it('sends noise decisions to their home on the core timeline, everything else to the inspector', () => {
    const chips = buildStripChips(busy);
    expect(chips.find(chip => chip.id === 'noise-suppressed')!.target).toEqual({
      anchor: 'timeline-intelligence',
    });
    expect(chips.find(chip => chip.id === 'similar')!.target).toEqual({ section: 'similar' });
  });

  it('drops triage once the viewer decided, and names an upstream incident when no change is known', () => {
    const decided = busyInsights({
      triage: {
        canAct: true,
        suggestions: busy.triage!.suggestions.map(s => ({ ...s, myVerdict: 'HELPFUL' as const })),
      },
      response: { ...busy.response!, changes: [] },
    });
    const chips = buildStripChips(decided);
    expect(chips.some(chip => chip.id === 'triage')).toBe(false);
    expect(chips.find(chip => chip.id === 'why')!.label).toBe('Likely cause: upstream Postgres');
  });

  it('shows no impact chip for context alone (components, a healthy objective)', () => {
    const healthy = busyInsights({
      impact: {
        ...busy.impact!,
        downstream: [],
        components: [
          {
            statusPageId: 'sp',
            statusPageName: 'Status',
            pageEnabled: true,
            componentName: 'API',
            serviceId: 'svc',
            direct: true,
            status: 'OPERATIONAL',
          },
        ],
        slo: { state: 'AVAILABLE', severity: 'none', objectives: [] },
      },
    });
    expect(buildStripChips(healthy).some(chip => chip.id === 'impact')).toBe(false);
    // The inspector still has the section: the strip is a summary, not the only way in.
    expect(insightsSections(healthy)).toContain('impact');
  });

  it('prompts for a stakeholder update when there is a nudge but no briefing', () => {
    const nudged = busyInsights({
      proactive: {
        briefing: null,
        postmortemDraft: null,
        nudge: {
          updatedAt: new Date(),
          minutesSinceUpdate: 42,
          thresholdMinutes: 30,
          draft: 'We are investigating.',
          aiDraft: null,
        },
      },
    });
    expect(buildStripChips(nudged).find(chip => chip.id === 'briefing')).toMatchObject({
      label: 'Stakeholder update due',
      tone: 'elevated',
    });
  });

  it('clips long labels so one chip cannot take the row', () => {
    const long = busyInsights({
      response: {
        ...busy.response!,
        changes: [{ ...busy.response!.changes[0], summary: 'x'.repeat(200) }],
      },
    });
    expect(buildStripChips(long).find(chip => chip.id === 'why')!.label.length).toBeLessThan(60);
  });

  it('renders nothing at all in OFF mode', () => {
    expect(buildStripChips(busyInsights({ mode: 'OFF' }))).toEqual([]);
  });
});

describe('insightsSections', () => {
  it('lists every section with content in the fixed order', () => {
    expect(insightsSections(busy)).toEqual([
      'briefing',
      'triage',
      'similar',
      'related',
      'why',
      'runbooks',
      'impact',
      'summary',
    ]);
  });

  it('offers a summary only while AI summaries are enabled and the mode is not OFF', () => {
    expect(insightsSections(quietInsights({ ai: { summaryEnabled: true } }))).toEqual(['summary']);
    expect(insightsSections(quietInsights({ mode: 'OFF', ai: { summaryEnabled: true } }))).toEqual(
      []
    );
  });

  it('accepts only known section names from a link', () => {
    expect(isInsightsSection('similar')).toBe(true);
    expect(isInsightsSection('timeline')).toBe(false);
    expect(isInsightsSection(null)).toBe(false);
  });
});

describe('showsFreshnessDot', () => {
  it.each(['WAITING', 'STALE', 'PAUSED', 'FAILED', 'UNAVAILABLE'] as const)(
    'shows the dot while analysis is %s',
    status => {
      expect(showsFreshnessDot({ status, message: 'm', canRefresh: false })).toBe(true);
    }
  );
  it.each(['CURRENT', 'SHADOW', 'OFF'] as const)('is silent when analysis is %s', status => {
    expect(showsFreshnessDot({ status, message: 'm', canRefresh: true })).toBe(false);
    expect(showsFreshnessDot(null)).toBe(false);
  });
});

describe('loadIncidentInsights', () => {
  it('composes the existing views for the viewer, each called with the same actor', async () => {
    const viewer = actor('RESPONDER');
    const insights = await loadIncidentInsights('inc-1', viewer, { client });
    expect(insights).toMatchObject({
      mode: 'SUGGEST',
      canManage: false,
      canGiveFeedback: true,
      noise: [{ kind: 'suppressed', label: 'Suppressed by Known noisy probe' }],
      ai: { summaryEnabled: true },
      squire: { enabled: true, mobileEnabled: false, name: 'Pip' },
    });
    expect(insights!.similar).toBe(busy.similar);
    for (const view of [views.similar, views.related, views.response, views.triage, views.group])
      expect(view).toHaveBeenCalledWith('inc-1', viewer, client);
    expect(views.badges).toHaveBeenCalledWith(['inc-1'], viewer, expect.anything(), client);
  });

  it('returns nothing when the incident is not readable to the viewer', async () => {
    (client!.incident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await loadIncidentInsights('inc-1', actor('RESPONDER'), { client })).toBeNull();
    expect(views.similar).not.toHaveBeenCalled();
  });

  it('OFF mode: nothing for responders, and no view is even read', async () => {
    views.policy.mockResolvedValue({ effectiveMode: 'OFF' });
    expect(await loadIncidentInsights('inc-1', actor('RESPONDER'), { client })).toBeNull();
    for (const view of Object.values(views)) {
      if (view !== views.policy) expect(view).not.toHaveBeenCalled();
    }
  });

  it('OFF mode: a manager gets only links that can still be undone', async () => {
    views.policy.mockResolvedValue({ effectiveMode: 'OFF' });
    const insights = await loadIncidentInsights('inc-1', actor('ADMIN'), { client });
    expect(insights).toMatchObject({
      mode: 'OFF',
      canManage: true,
      similar: null,
      triage: null,
      response: null,
      impact: null,
      proactive: null,
      analysis: null,
      noise: [],
      squire: { enabled: false },
    });
    expect(insights!.related).toBe(busy.related);
    expect(insights!.group).toBe(busy.group);
    expect(views.similar).not.toHaveBeenCalled();
    expect(views.triage).not.toHaveBeenCalled();
    expect(insightsSections(insights!)).toEqual(['related']);
  });

  it('is fail-soft: a failing view is logged and treated as nothing to show', async () => {
    views.similar.mockRejectedValue(new Error('db down'));
    views.impact.mockRejectedValue(new Error('timeout'));
    views.ai.mockRejectedValue(new Error('no settings'));
    views.analysis.mockRejectedValue(new Error('boom'));
    const insights = await loadIncidentInsights('inc-1', actor('RESPONDER'), { client });
    expect(insights).toMatchObject({
      similar: null,
      impact: null,
      ai: { summaryEnabled: false },
      squire: { enabled: false, name: 'Squire' },
      analysis: { status: 'UNAVAILABLE', canRefresh: false },
    });
    // Everything that did not fail is still there.
    expect(insights!.response).toBe(busy.response);
    expect(insights!.triage).toBe(busy.triage);
    expect(views.warn).toHaveBeenCalledTimes(4);
    expect(showsFreshnessDot(insights!.analysis)).toBe(true);
  });
});
