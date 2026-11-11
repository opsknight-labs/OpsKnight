import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IncidentTimeAxis } from '@/lib/intelligence/timeline/service';
import type { ResponseIntelligenceView } from '@/lib/intelligence/response/view';

const mocks = vi.hoisted(() => ({ axis: vi.fn(), response: vi.fn(), actor: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/intelligence/timeline/service', () => ({
  getIncidentTimeAxisForActor: mocks.axis,
}));
vi.mock('@/lib/intelligence/response/view', () => ({
  getResponseIntelligenceForActor: mocks.response,
}));
vi.mock('@/components/incident/runbooks/AdhocRunbookLauncher', () => ({ default: () => null }));
vi.mock('@/components/incident/IntelligenceEmptyState', () => ({ default: () => null }));

import IncidentTimeAxisCard from '@/components/incident/IncidentTimeAxisCard';
import IncidentResponseCard from '@/components/incident/IncidentResponseCard';

const onset = new Date('2026-11-10T11:36:00Z');
const anomalyAt = new Date('2026-11-10T11:30:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: 'u', role: 'ADMIN', teamIds: [], status: 'ACTIVE' });
});

describe('metric anomalies on incident surfaces', () => {
  it('renders a metric anomaly on the time axis with its label, offset and detail', async () => {
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
    mocks.axis.mockResolvedValue(axis);
    const html = renderToStaticMarkup(await IncidentTimeAxisCard({ incidentId: 'i' }));
    expect(html).toContain('p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)');
    expect(html).toContain('Metric anomaly · 6 min before · Orders DB · 412 vs usual 120');
    expect(html).toContain('bg-status-critical');
    expect(html).toContain('metric anomalies');
    expect(html.indexOf('deviated')).toBeLessThan(html.indexOf('Incident opened'));
  });

  it('lists metric anomalies among possible causes, including one just after onset', async () => {
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
    mocks.response.mockResolvedValue(view);
    const html = renderToStaticMarkup(await IncidentResponseCard({ incidentId: 'i' }));
    expect(html).toContain('Metrics that moved');
    expect(html).toContain('p99 latency deviated at 11:30 UTC by 7.3 MAD (rose)');
    expect(html).toContain(
      '6 min before onset · Upstream dependency (Orders DB) · 412 vs usual 120.25'
    );
    expect(html).toContain('2 min after onset · Same service (Web)');
  });

  it('renders no metric section when the view has none (existing views are unchanged)', async () => {
    mocks.response.mockResolvedValue({
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
    const html = renderToStaticMarkup(await IncidentResponseCard({ incidentId: 'i' }));
    expect(html).not.toContain('Metrics that moved');
    expect(html).toContain('Restart');
  });
});
