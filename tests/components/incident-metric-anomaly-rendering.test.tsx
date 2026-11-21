import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IncidentTimeAxis } from '@/lib/intelligence/timeline/service';
import type { ResponseIntelligenceView } from '@/lib/intelligence/response/view';

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
import {
  INTELLIGENCE_TIMELINE_KIND_LABEL,
  formatOnsetOffset,
  toIntelligenceTimelineEvents,
} from '@/lib/intelligence/incident-ux/timeline-overlay';
import { quietInsights } from '../helpers/incident-insights-fixture';

// The response card and the time-axis card became the inspector's "Possible causes" section and rows of
// the core timeline; these cases follow the facts to their one place.
const causes = (response: ResponseIntelligenceView) => {
  const insights = quietInsights({ response });
  return renderToStaticMarkup(
    <InsightsSections insights={insights} sections={insightsSections(insights)} />
  );
};

const onset = new Date('2026-11-10T11:36:00Z');
const anomalyAt = new Date('2026-11-10T11:30:00Z');

describe('metric anomalies on incident surfaces', () => {
  it('puts a metric anomaly on the core timeline with its label, offset and detail', () => {
    const axis: IncidentTimeAxis = {
      onset,
      truncated: false,
      canReverse: false,
      entries: [
        {
          kind: 'METRIC_ANOMALY',
          at: anomalyAt,
          title: 'p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)',
          detail: 'Orders DB · 412 vs usual 120',
          href: null,
          offsetMinutes: -6,
        },
        {
          kind: 'INCIDENT',
          at: onset,
          title: 'Incident opened: Web errors',
          detail: null,
          href: null,
          offsetMinutes: 0,
        },
      ],
    };
    const [row, ...rest] = toIntelligenceTimelineEvents(axis);
    expect(rest).toEqual([]);
    expect(row.title).toBe('p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)');
    expect(
      `${INTELLIGENCE_TIMELINE_KIND_LABEL[row.kind]} · ${formatOnsetOffset(row.offsetMinutes)} · ${row.detail}`
    ).toBe('Metric anomaly · 6 min before · Orders DB · 412 vs usual 120');
  });

  it('lists metric anomalies among possible causes, including one just after onset', () => {
    const view: ResponseIntelligenceView = {
      changes: [],
      upstreamIncidents: [],
      runbooks: [],
      metricAnomalies: [
        {
          findingId: 'f1',
          anomalyId: 'a1',
          title: 'p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)',
          templateName: 'p99 latency',
          serviceName: 'Orders DB',
          at: anomalyAt,
          direction: 'UP',
          madScore: 7.3,
          value: 412,
          baselineMedian: 120.25,
          relation: 'UPSTREAM',
          leadMinutes: 6,
          confidencePercent: 40,
        },
        {
          findingId: 'f2',
          anomalyId: 'a2',
          title: 'error rate deviated at 11:38 UTC by 5.1 MAD (rose)',
          templateName: 'error rate',
          serviceName: 'Web',
          at: new Date('2026-11-10T11:38:00Z'),
          direction: 'UP',
          madScore: 5.1,
          value: 3,
          baselineMedian: 0.5,
          relation: 'SAME_SERVICE',
          leadMinutes: -2,
          confidencePercent: 30,
        },
      ],
    };
    const html = causes(view);
    expect(html).toContain('Metrics that moved');
    expect(html).toContain('p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)');
    expect(html).toContain(
      '6 min before onset · Upstream dependency (Orders DB) · 412 vs usual 120.25'
    );
    expect(html).toContain('2 min after onset · Same service (Web)');
  });

  it('renders no metric section when the view has none (existing views are unchanged)', () => {
    const html = causes({
      changes: [],
      upstreamIncidents: [],
      runbooks: [
        {
          findingId: 'r',
          runbookId: 'rb',
          name: 'Restart',
          succeeded: 1,
          eligible: 1,
          bound: true,
        },
      ],
    } satisfies ResponseIntelligenceView);
    expect(html).not.toContain('Metrics that moved');
    expect(html).toContain('Restart');
  });
});
