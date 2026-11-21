import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AlertsTable, { DecisionChip } from '@/components/intelligence/lists/AlertsTable';
import ChangesTable from '@/components/intelligence/lists/ChangesTable';
import ListFilterBar from '@/components/intelligence/lists/ListFilterBar';
import { ListPagination } from '@/components/intelligence/lists/shared';
import NeedsAttention from '@/components/intelligence/overview/NeedsAttention';
import { OverviewSection } from '@/components/intelligence/overview/primitives';
import type { AlertListRow } from '@/lib/intelligence/lists/alerts';
import type { ChangeListRow } from '@/lib/intelligence/lists/changes';
import type { AttentionItem } from '@/lib/intelligence/overview/attention-contract';

beforeEach(() => push.mockReset());

const alert = (overrides: Partial<AlertListRow> = {}): AlertListRow => ({
  id: 'alert-1',
  summary: 'Disk usage above 90%',
  serviceId: 'svc-1',
  serviceName: 'Checkout',
  severity: 'critical',
  status: 'TRIGGERED',
  labels: [{ key: 'env', value: 'prod' }],
  moreLabels: 2,
  receivedAt: new Date('2026-11-10T08:15:00Z'),
  incidentId: 'inc-1',
  decision: null,
  ...overrides,
});

const change = (overrides: Partial<ChangeListRow> = {}): ChangeListRow => ({
  id: 'chg-1',
  summary: 'checkout v43 rollout',
  source: 'github-actions',
  kind: 'FEATURE_FLAG',
  version: 'v43',
  serviceId: 'svc-1',
  serviceName: 'Checkout',
  occurredAt: new Date('2026-11-10T07:00:00Z'),
  riskScore: 0.81,
  linkedIncidents: [{ id: 'inc-9', title: 'Checkout latency' }],
  linkedIncidentCount: 3,
  ...overrides,
});

describe('AlertsTable', () => {
  it('links each row to the alert, its service and its incident', () => {
    render(<AlertsTable rows={[alert()]} />);
    const table = screen.getByRole('table', { name: 'Alerts, newest first' });
    expect(within(table).getByRole('link', { name: 'Disk usage above 90%' })).toHaveAttribute(
      'href',
      '/alerts/alert-1'
    );
    expect(within(table).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      '/services/svc-1'
    );
    expect(within(table).getByRole('link', { name: 'Open incident' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    expect(within(table).getAllByText('critical').length).toBeGreaterThan(0);
    expect(within(table).getByText('env=prod')).toBeInTheDocument();
    expect(within(table).getByText('+2 more')).toBeInTheDocument();
    expect(within(table).getAllByText('2026-11-10 08:15 UTC').length).toBeGreaterThan(0);
  });

  it('gives the alert link a 44 px target on phone widths', () => {
    render(<AlertsTable rows={[alert()]} />);
    expect(screen.getByRole('link', { name: 'Disk usage above 90%' }).className).toContain(
      'min-h-11'
    );
  });

  it('is silent about a decision, severity, labels and incident the alert does not have', () => {
    render(
      <AlertsTable
        rows={[alert({ severity: null, labels: [], moreLabels: 0, incidentId: null })]}
      />
    );
    expect(screen.queryByText(/Suppressed|Shadow|maintenance|Grouped|Deduplicated/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Labels' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open incident' })).toBeNull();
    expect(screen.queryByText('Severity:')).toBeNull();
  });

  it('names an applied decision and marks a shadow one as not applied', () => {
    const { rerender } = render(
      <DecisionChip
        decision={{
          kind: 'suppressed',
          applied: true,
          sourceName: 'Known disk alarm',
          reason: 'r',
        }}
      />
    );
    expect(screen.getByText('Suppressed')).toBeInTheDocument();
    expect(screen.getByText('Known disk alarm')).toBeInTheDocument();
    rerender(
      <DecisionChip
        decision={{ kind: 'maintenance', applied: false, sourceName: null, reason: 'r' }}
      />
    );
    expect(screen.getByText('Shadow: in maintenance')).toBeInTheDocument();
  });
});

describe('ChangesTable', () => {
  it('shows source, kind, service, risk band and linked incidents', () => {
    render(<ChangesTable rows={[change()]} />);
    const table = screen.getByRole('table', { name: 'Changes, newest first' });
    expect(within(table).getByRole('link', { name: 'checkout v43 rollout' })).toHaveAttribute(
      'href',
      '/changes/chg-1'
    );
    expect(within(table).getByText('feature flag')).toBeInTheDocument();
    expect(within(table).getAllByText('github-actions').length).toBeGreaterThan(0);
    // The band label always accompanies the colour.
    expect(within(table).getAllByText(/High risk · 81%/).length).toBeGreaterThan(0);
    const incidents = within(table).getAllByRole('link', { name: 'Checkout latency' });
    expect(incidents[0]).toHaveAttribute('href', '/incidents/inc-9');
    expect(within(table).getAllByText('+2 more').length).toBeGreaterThan(0);
  });

  it('says a change is not scored instead of showing a zero, and omits absent links', () => {
    render(
      <ChangesTable
        rows={[
          change({
            riskScore: null,
            linkedIncidents: [],
            linkedIncidentCount: 0,
            serviceId: null,
            serviceName: null,
          }),
        ]}
      />
    );
    expect(screen.getAllByText('Not scored').length).toBeGreaterThan(0);
    expect(screen.queryByText(/risk · 0%/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Linked incidents' })).toBeNull();
    expect(screen.getAllByText('No service').length).toBeGreaterThan(0);
  });
});

describe('ListFilterBar', () => {
  const fields = [
    {
      name: 'service',
      label: 'Service',
      value: '',
      anyLabel: 'All services',
      options: [{ value: 'svc-1', label: 'Checkout' }],
    },
    {
      name: 'window',
      label: 'Time range',
      value: '24h',
      options: [
        { value: '24h', label: 'Last 24 hours' },
        { value: '7d', label: 'Last 7 days' },
      ],
    },
  ];

  it('navigates on change, leaving defaults and the cursor out of the URL', () => {
    render(
      <ListFilterBar
        basePath="/alerts"
        label="Filter alerts"
        fields={fields}
        defaults={{ window: '24h' }}
      />
    );
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc-1' } });
    expect(push).toHaveBeenLastCalledWith('/alerts?service=svc-1');
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '7d' } });
    expect(push).toHaveBeenLastCalledWith('/alerts?service=svc-1&window=7d');
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '24h' } });
    expect(push).toHaveBeenLastCalledWith('/alerts');
  });

  it('is a labelled GET form that also works from the Apply button', () => {
    render(<ListFilterBar basePath="/changes" label="Filter changes" fields={fields} />);
    const form = screen.getByRole('search', { name: 'Filter changes' });
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/changes');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(push).toHaveBeenCalledWith('/changes?window=24h');
  });

  it('offers Clear filters only when a filter is active', () => {
    const { rerender } = render(
      <ListFilterBar basePath="/alerts" label="f" fields={fields} defaults={{ window: '24h' }} />
    );
    expect(screen.queryByRole('link', { name: 'Clear filters' })).toBeNull();
    rerender(
      <ListFilterBar
        basePath="/alerts"
        label="f"
        fields={[{ ...fields[0], value: 'svc-1' }, fields[1]]}
        defaults={{ window: '24h' }}
      />
    );
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/alerts');
  });

  it('keeps controls at a 44 px touch height on phones', () => {
    render(<ListFilterBar basePath="/alerts" label="f" fields={fields} />);
    expect(screen.getByLabelText('Service').className).toContain('h-11');
    expect(screen.getByRole('button', { name: 'Apply' }).className).toContain('h-11');
  });
});

describe('ListPagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(
      <ListPagination label="Pages" firstHref="/alerts" nextHref={null} onFirstPage shown={3} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('links to the next page and back to the first', () => {
    render(
      <ListPagination
        label="Alert pages"
        firstHref="/alerts?window=7d"
        nextHref="/alerts?window=7d&cursor=abc.1"
        onFirstPage={false}
        shown={50}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Alert pages' });
    expect(within(nav).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/alerts?window=7d&cursor=abc.1'
    );
    expect(within(nav).getByRole('link', { name: 'First page' })).toHaveAttribute(
      'href',
      '/alerts?window=7d'
    );
    expect(within(nav).getByText('Showing 50 rows, newest first.')).toBeInTheDocument();
  });
});

describe('NeedsAttention', () => {
  const items: AttentionItem[] = [
    {
      id: 'triage:inc-1',
      kind: 'triage',
      title: 'Checkout latency',
      detail: '2 triage suggestions awaiting a decision',
      href: '/incidents/inc-1?insights=triage',
    },
    {
      id: 'dependencies',
      kind: 'dependencies',
      title: '4 observed dependencies to review',
      detail: 'Inferred from incidents that keep occurring together.',
      href: '/settings/intelligence/services#dependencies',
    },
  ];

  it('renders nothing when the inbox is empty', () => {
    const { container } = render(<NeedsAttention items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every item as a 44 px link to the place to act', () => {
    render(<NeedsAttention items={items} />);
    const section = screen.getByRole('region', { name: 'Needs attention' });
    const links = within(section).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/incidents/inc-1?insights=triage',
      '/settings/intelligence/services#dependencies',
    ]);
    for (const link of links) expect(link.className).toContain('min-h-11');
    expect(within(section).getByText('Triage')).toBeInTheDocument();
    expect(within(section).getByText('Dependencies')).toBeInTheDocument();
    expect(section).toHaveTextContent('2 items');
  });

  it('lets the mobile page point rows at mobile routes', () => {
    render(
      <NeedsAttention
        items={items}
        resolveHref={href => (href.startsWith('/incidents') ? `/m${href}` : href)}
      />
    );
    expect(screen.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/m/incidents/inc-1?insights=triage'
    );
  });
});

describe('OverviewSection drill-down', () => {
  it('adds a labelled link to the full list, and none when not given', () => {
    const { rerender } = render(
      <OverviewSection
        id="overview-noise"
        title="Noise"
        drilldown={{ href: '/alerts', label: 'View alerts' }}
      >
        <p>body</p>
      </OverviewSection>
    );
    const link = screen.getByRole('link', { name: 'View alerts' });
    expect(link).toHaveAttribute('href', '/alerts');
    expect(link.className).toContain('min-h-11');
    rerender(
      <OverviewSection id="overview-noise" title="Noise">
        <p>body</p>
      </OverviewSection>
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
