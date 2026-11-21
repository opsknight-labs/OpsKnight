import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IncidentImpactView } from '@/lib/intelligence/impact/view';

import { ImpactCardBody } from '@/components/incident/IncidentImpactCard';

const empty: IncidentImpactView = {
  serviceId: 'svc',
  downstream: [],
  downstreamTruncated: false,
  components: [],
  componentsTruncated: false,
  slo: { state: 'NONE' },
};

const full: IncidentImpactView = {
  serviceId: 'svc',
  downstream: [
    { id: 'web', name: 'Web', distance: 1, status: 'DEGRADED', openIncidents: 2 },
    { id: 'mobile', name: 'Mobile', distance: 2, status: 'OPERATIONAL', openIncidents: 0 },
  ],
  downstreamTruncated: true,
  components: [
    {
      statusPageId: 'p',
      statusPageName: 'Public status',
      pageEnabled: true,
      componentName: 'Checkout API',
      serviceId: 'svc',
      direct: true,
      status: 'MAJOR_OUTAGE',
    },
  ],
  componentsTruncated: false,
  slo: {
    state: 'AVAILABLE',
    severity: 'critical',
    objectives: [
      {
        name: 'Availability',
        targetPercent: 99.9,
        fastBurn: 20,
        slowBurn: 4,
        severity: 'critical',
        budgetMinutes: 43.2,
        incidentBudgetPercent: 46.3,
      },
    ],
  },
};

describe('IncidentImpactCard', () => {
  it('renders dependent services, components with status and the budget at risk', () => {
    const html = renderToStaticMarkup(<ImpactCardBody view={full} />);
    expect(html).toContain('Estimated impact');
    expect(html).toContain('href="/services/web"');
    expect(html).toContain('Dependent services (2+)');
    expect(html).toContain('2 open incidents');
    expect(html).toContain('2 hops');
    expect(html).toContain('Checkout API');
    expect(html).toContain('Major outage');
    expect(html).toContain('Burning fast');
    expect(html).toContain('46.3% of the');
  });

  it('marks a burning downstream SLO and counts the subscribers, and stays silent at zero', () => {
    const html = renderToStaticMarkup(
      <ImpactCardBody
        view={{
          ...full,
          downstream: [
            { ...full.downstream[0], sloBurn: 'warning' },
            { ...full.downstream[1], sloBurn: 'none' },
          ],
          subscribers: { total: 10_000, capped: true, pages: 2 },
        }}
      />
    );
    expect(html).toContain('SLO burning');
    expect(html.match(/SLO /g)).toHaveLength(1);
    expect(html).toContain(
      '10,000+ subscribers get updates for these components on 2 published pages'
    );
    const silent = renderToStaticMarkup(
      <ImpactCardBody view={{ ...full, subscribers: { total: 0, capped: false, pages: 1 } }} />
    );
    expect(silent).not.toContain('subscriber');
  });

  it('uses the shared empty state when nothing applies, and explains a restricted SLO', () => {
    const none = renderToStaticMarkup(<ImpactCardBody view={empty} />);
    expect(none).toContain('No wider impact found');
    expect(none).not.toContain('Estimated impact');
    const restricted = renderToStaticMarkup(
      <ImpactCardBody view={{ ...empty, slo: { state: 'RESTRICTED' } }} />
    );
    expect(restricted).toContain('global metrics access');
  });

  it('hides SLO details from a viewer without metric visibility but still shows the graph', () => {
    const html = renderToStaticMarkup(
      <ImpactCardBody view={{ ...full, slo: { state: 'RESTRICTED' } }} />
    );
    expect(html).toContain('Web');
    expect(html).not.toContain('Error budget at risk');
  });

  it('shows an optional action beside its heading (the inspector passes "Ask Squire")', () => {
    const html = renderToStaticMarkup(
      <ImpactCardBody view={full} action={<button type="button">Ask Pip</button>} />
    );
    expect(html).toContain('Ask Pip');
    expect(html).toContain('<h3 id="incident-impact-heading"');
  });
});
