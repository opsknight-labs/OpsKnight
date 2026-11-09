import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IncidentImpactView } from '@/lib/intelligence/impact/view';

const mocks = vi.hoisted(() => ({ view: vi.fn(), actor: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/intelligence/impact/view', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intelligence/impact/view')>(
    '@/lib/intelligence/impact/view'
  );
  return { ...actual, getIncidentImpactForActor: mocks.view };
});

import IncidentImpactCard, { ImpactCardBody } from '@/components/incident/IncidentImpactCard';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ userId: 'u', role: 'RESPONDER' });
});

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

  it('loads the view for the current actor and renders nothing when it is unavailable or fails', async () => {
    mocks.view.mockResolvedValueOnce(full);
    const html = renderToStaticMarkup((await IncidentImpactCard({ incidentId: 'inc' }))!);
    expect(mocks.view).toHaveBeenCalledWith('inc', { userId: 'u', role: 'RESPONDER' });
    expect(html).toContain('Checkout API');

    mocks.view.mockResolvedValueOnce(null);
    expect(await IncidentImpactCard({ incidentId: 'inc' })).toBeNull();

    mocks.view.mockRejectedValueOnce(new Error('db down'));
    expect(await IncidentImpactCard({ incidentId: 'inc' })).toBeNull();
  });
});
