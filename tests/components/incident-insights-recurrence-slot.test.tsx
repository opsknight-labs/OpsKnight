import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/(app)/incidents/[id]/triage-actions', () => ({ decideTriage: vi.fn() }));
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  rateSimilarIncident: vi.fn(),
  decideRelatedIncident: vi.fn(),
  markIncidentRelated: vi.fn(),
  summarizeIncidentAction: vi.fn(),
}));
vi.mock('@/app/(app)/incidents/[id]/noise-actions', () => ({
  reverseIncidentNoiseDecision: vi.fn(),
  postSummaryAsNoteAction: vi.fn(),
}));
vi.mock('@/components/incident/runbooks/AdhocRunbookLauncher', () => ({ default: () => null }));

import InsightsSections from '@/components/incident/intelligence/InsightsSections';
import { insightsSections } from '@/lib/intelligence/incident-ux/strip';
import { quietInsights } from '../helpers/incident-insights-fixture';

// The postmortem recurrence strip (J4) streams into the inspector through a slot (Workstream I owns the
// inspector); with no slot, or an empty one, the inspector is unchanged.
describe('incident inspector recurrence slot', () => {
  const insights = quietInsights({});
  const render = (recurrence?: ReactNode) =>
    renderToStaticMarkup(
      <InsightsSections
        insights={insights}
        sections={insightsSections(insights)}
        recurrence={recurrence}
      />
    );

  it('renders the recurrence content when given', () => {
    expect(render(<p>Seen 3 times in 90 days</p>)).toContain('Seen 3 times in 90 days');
  });

  it('renders the same markup as before when the slot is empty', () => {
    expect(render(null)).toBe(render(undefined));
  });
});
