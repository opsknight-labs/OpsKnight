import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { insightsSections, type IncidentInsights } from '@/lib/intelligence/incident-ux/strip';

const insights = (proactive: unknown) =>
  ({
    mode: 'SUGGEST',
    ai: { summaryEnabled: true },
    proactive,
    response: null,
    impact: null,
  }) as unknown as IncidentInsights;

describe('one incident summary in the inspector', () => {
  it('shows the on-demand AI summary only when the briefing has no AI summary of its own', () => {
    expect(insightsSections(insights(null))).toEqual(['summary']);
    const deterministic = {
      briefing: { headline: 'h', ai: null },
      nudge: null,
      postmortemDraft: null,
    };
    expect(insightsSections(insights(deterministic))).toEqual(['briefing', 'summary']);
    const written = {
      briefing: { headline: 'h', ai: { headline: 'AI', currentState: 's' } },
      nudge: null,
      postmortemDraft: null,
    };
    expect(insightsSections(insights(written))).toEqual(['briefing']);
  });
});
