import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/(app)/settings/intelligence/response/actions', () => ({
  createNoisyAlertIssueAction: vi.fn(async () => ({ ok: true, message: 'Created OPS-1.' })),
}));

import NoisePanel from '@/components/intelligence/overview/NoisePanel';
import SpeedPanel from '@/components/intelligence/overview/SpeedPanel';
import QualityPanel from '@/components/intelligence/overview/QualityPanel';
import ChangePanel, { riskBand } from '@/components/intelligence/overview/ChangePanel';
import OutcomesPanel, { bucketLabel } from '@/components/intelligence/overview/OutcomesPanel';
import HealthPanel from '@/components/intelligence/overview/HealthPanel';
import WindowSelector from '@/components/intelligence/overview/WindowSelector';
import {
  FeatureOff,
  SectionError,
  SectionSkeleton,
  relativeDelta,
} from '@/components/intelligence/overview/primitives';
import type { OverviewNoise } from '@/lib/intelligence/overview/noise';
import type { OverviewSpeed } from '@/lib/intelligence/overview/speed';
import type { OverviewQuality } from '@/lib/intelligence/overview/quality';
import type { OverviewChange } from '@/lib/intelligence/overview/change';
import type { OverviewOutcomes } from '@/lib/intelligence/overview/outcomes';
import type { AlertQualityRow } from '@/lib/intelligence/triage/alert-quality';

const noise = (overrides: Partial<OverviewNoise> = {}): OverviewNoise => ({
  modes: { on: 1, shadow: 0 },
  alerts: 12_900,
  incidents: 300,
  compressionRatio: 43,
  pagesAvoided: 120,
  shadowWouldAvoid: 40,
  downgraded: 3,
  grouped: 50,
  ungrouped: 5,
  falseGroupRate: 0.1,
  suppressedBySource: [
    { key: 'SUPPRESSION:r1', label: 'Known disk alarm', control: 'SUPPRESSION', count: 90 },
    { key: 'MAINTENANCE:w1', label: 'Sunday patching', control: 'MAINTENANCE', count: 30 },
  ],
  heartbeats: { monitors: 0, missing: 0, late: 0 },
  ...overrides,
});

const tile = (label: string) => {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.parentElement as HTMLElement;
};

describe('NoisePanel', () => {
  it('shows compression, applied pages avoided and shadow "would have" separately', () => {
    render(<NoisePanel data={noise()} windowLabel="Last 7 days" canManage={false} />);
    expect(within(tile('Alerts received')).getByText('12.9K')).toBeInTheDocument();
    expect(within(tile('Compression')).getByText('43×')).toBeInTheDocument();
    expect(within(tile('Pages avoided')).getByText('120')).toBeInTheDocument();
    expect(within(tile('Would have avoided')).getByText('40')).toBeInTheDocument();
    expect(
      within(tile('Would have avoided')).getByText(/nothing was held back/)
    ).toBeInTheDocument();
    expect(within(tile('False-group rate')).getByText('10%')).toBeInTheDocument();
    const bars = screen.getByRole('list', { name: /suppressed per rule or maintenance window/ });
    const rows = within(bars).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Known disk alarm'),
      expect.stringContaining('Sunday patching'),
    ]);
  });

  it('explains that nothing is suppressed while every control is in shadow', () => {
    render(
      <NoisePanel
        data={noise({ modes: { on: 0, shadow: 2 }, pagesAvoided: 0, suppressedBySource: [] })}
        windowLabel="Last 7 days"
        canManage
      />
    );
    expect(screen.getByText(/Every control is in shadow mode/)).toBeInTheDocument();
    expect(within(tile('Pages avoided')).getByText('0')).toBeInTheDocument();
  });

  it('tells administrators how to turn noise controls on, and only them', () => {
    const off = noise({ modes: { on: 0, shadow: 0 }, suppressedBySource: [] });
    const { unmount } = render(<NoisePanel data={off} windowLabel="Last 7 days" canManage />);
    expect(screen.getByText('Noise controls are off')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute(
      'href',
      '/settings/intelligence/noise-controls'
    );
    unmount();
    render(<NoisePanel data={off} windowLabel="Last 7 days" canManage={false} />);
    expect(screen.getByText('Noise controls are off')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open settings' })).toBeNull();
    expect(screen.getByText(/Ask an administrator/)).toBeInTheDocument();
  });
});

const speed = (overrides: Partial<OverviewSpeed> = {}): OverviewSpeed => ({
  incidents: 40,
  incidentsWithInsight: 30,
  firstInsightP50Seconds: 45,
  firstInsightP90Seconds: 720,
  relatedSuggestions: { accepted: 3, reviewed: 4, rate: 0.75 },
  findings: { accepted: 0, reviewed: 0, rate: null },
  triage: { accepted: 1, reviewed: 2, rate: 0.5 },
  sampleTruncated: false,
  ...overrides,
});

describe('SpeedPanel', () => {
  it('shows time to first insight and acceptance, and never fabricates a rate without reviews', () => {
    render(<SpeedPanel data={speed()} windowLabel="Last 7 days" triageEnabled canManage={false} />);
    expect(within(tile('First insight, median')).getByText('45 s')).toBeInTheDocument();
    expect(
      within(tile('First insight, median')).getByText('30 of 40 incidents had an insight')
    ).toBeInTheDocument();
    expect(within(tile('First insight, 90th percentile')).getByText('12 min')).toBeInTheDocument();
    expect(within(tile('Related suggestions accepted')).getByText('75%')).toBeInTheDocument();
    expect(within(tile('Findings rated helpful')).getByText('—')).toBeInTheDocument();
    expect(
      within(tile('Findings rated helpful')).getByText('No rated reviewed yet')
    ).toBeInTheDocument();
    expect(within(tile('Triage chips accepted')).getByText('50%')).toBeInTheDocument();
  });

  it('replaces the triage tile with a turn-on hint when triage is off', () => {
    render(<SpeedPanel data={speed()} windowLabel="Last 7 days" triageEnabled={false} canManage />);
    expect(screen.queryByText('Triage chips accepted')).toBeNull();
    expect(screen.getByText('Triage suggestions are off')).toBeInTheDocument();
  });
});

const qualityRow = (overrides: Partial<AlertQualityRow>): AlertQualityRow => ({
  serviceId: 'svc-1',
  serviceName: 'Checkout',
  teamId: 't1',
  teamName: 'Payments',
  incidents: 20,
  quickResolvedRatio: 0.8,
  neverAcknowledgedRatio: 0.6,
  flappingRatio: 0,
  noiseScore: 0.7,
  flagged: true,
  ...overrides,
});

describe('QualityPanel', () => {
  const data: OverviewQuality = {
    windowDays: 30,
    noisy: [qualityRow({})],
    flapping: [qualityRow({ serviceId: 'svc-2', serviceName: 'Search', flappingRatio: 0.4 })],
    jiraConfigured: true,
  };

  it('gives administrators one-click links to the existing fix flows', () => {
    render(<QualityPanel data={data} canManage />);
    const noisy = screen.getByRole('list', { name: 'Noisiest services' });
    expect(
      within(noisy).getByRole('link', { name: 'Create suppression rule for Checkout' })
    ).toHaveAttribute('href', '/settings/intelligence/noise-controls?service=svc-1');
    expect(
      within(noisy).getByRole('link', { name: 'Lower severity for Checkout' })
    ).toHaveAttribute('href', '/services/svc-1/automation');
    expect(
      within(noisy).getByRole('button', { name: 'Open Jira issue for Checkout' })
    ).toBeEnabled();
    const flapping = screen.getByRole('list', { name: 'Flapping services' });
    expect(
      within(flapping).getByText(/40% of 20 incidents opened as flapping/)
    ).toBeInTheDocument();
  });

  it('offers responders only a link to the service, never the fix actions', () => {
    render(<QualityPanel data={data} canManage={false} />);
    expect(screen.queryByRole('link', { name: /Create suppression rule/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open Jira issue/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'View service Checkout' })).toHaveAttribute(
      'href',
      '/services/svc-1'
    );
  });

  it('hides the Jira action when Jira is not configured and explains an empty list', () => {
    const { unmount } = render(
      <QualityPanel data={{ ...data, jiraConfigured: false }} canManage />
    );
    expect(screen.queryByRole('button', { name: /Open Jira issue/ })).toBeNull();
    unmount();
    render(<QualityPanel data={{ ...data, noisy: [], flapping: [] }} canManage />);
    expect(
      screen.getByText(/No noisy or flapping services in the last 30 days/)
    ).toBeInTheDocument();
  });
});

const change = (overrides: Partial<OverviewChange> = {}): OverviewChange => ({
  incidents: 10,
  changeLinked: 2,
  recentLinked: [
    {
      incidentId: 'inc-1',
      title: 'Checkout 500s',
      createdAt: new Date('2026-11-08T10:00:00Z'),
      change: { id: 'chg-1', summary: 'checkout v42' },
    },
  ],
  changes: 3,
  scoredChanges: 3,
  riskiest: [
    {
      id: 'chg-1',
      summary: 'checkout v42',
      kind: 'DEPLOY',
      source: 'ci',
      serviceId: 'svc-1',
      serviceName: 'Checkout',
      occurredAt: new Date('2026-11-08T09:50:00Z'),
      riskScore: 0.72,
      url: null,
    },
  ],
  sampleTruncated: false,
  ...overrides,
});

describe('ChangePanel', () => {
  it('shows the change-linked share and the riskiest changes with a labelled risk band', () => {
    render(
      <ChangePanel data={change()} windowLabel="Last 7 days" responseEnabled canManage={false} />
    );
    expect(
      within(tile('Change-linked incidents')).getByText('20% of 10 incidents')
    ).toBeInTheDocument();
    const risky = screen.getByRole('list', { name: 'Riskiest recent changes' });
    expect(within(risky).getByRole('link', { name: 'checkout v42' })).toHaveAttribute(
      'href',
      '/changes/chg-1'
    );
    expect(within(risky).getByText(/High risk · 72%/)).toBeInTheDocument();
    const linked = screen.getByRole('list', { name: 'Recent change-linked incidents' });
    expect(within(linked).getByRole('link', { name: 'Checkout 500s' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
  });

  it('bands risk without relying on colour alone', () => {
    expect(riskBand(0.8).label).toBe('High risk');
    expect(riskBand(0.4).label).toBe('Medium risk');
    expect(riskBand(0.1).label).toBe('Low risk');
  });

  it('explains how to feed changes when none were recorded', () => {
    render(
      <ChangePanel
        data={change({
          changes: 0,
          changeLinked: 0,
          riskiest: [],
          recentLinked: [],
          scoredChanges: 0,
        })}
        windowLabel="Last 7 days"
        responseEnabled
        canManage
      />
    );
    expect(screen.getByText('No changes recorded in this window')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute(
      'href',
      '/settings/intelligence/response'
    );
  });
});

describe('OutcomesPanel', () => {
  const outcomes: OverviewOutcomes = {
    current: { incidents: 10, acknowledged: 8, resolved: 6, mttaSeconds: 300, mttrSeconds: 3600 },
    previous: { incidents: 5, acknowledged: 5, resolved: 5, mttaSeconds: 600, mttrSeconds: 1800 },
    series: Array.from({ length: 7 }, (_, index) => ({
      index,
      current: { incidents: 1, mttaSeconds: index === 6 ? 300 : null, mttrSeconds: 3600 },
      previous: { incidents: 1, mttaSeconds: 600, mttrSeconds: 1800 },
    })),
  };

  it('compares MTTA and MTTR with the previous window, judging lower as better', () => {
    render(
      <OutcomesPanel data={outcomes} windowKey="7d" since={new Date('2026-11-02T00:00:00Z')} />
    );
    const mtta = tile('Mean time to acknowledge');
    expect(within(mtta).getByText('5 min')).toBeInTheDocument();
    expect(within(mtta).getByText(/−50% vs previous 7d/)).toBeInTheDocument();
    expect(within(mtta).getByText('(better)')).toBeInTheDocument();
    const mttr = tile('Mean time to resolve');
    expect(within(mttr).getByText(/\+100% vs previous 7d/)).toBeInTheDocument();
    expect(within(mttr).getByText('(worse)')).toBeInTheDocument();
    // Volume is shown without a better/worse judgement.
    expect(within(tile('Incidents')).queryByText(/better|worse/)).toBeNull();
  });

  it('draws one small multiple per measure and offers a data table', () => {
    render(
      <OutcomesPanel data={outcomes} windowKey="7d" since={new Date('2026-11-02T00:00:00Z')} />
    );
    expect(screen.getAllByRole('img')).toHaveLength(2);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(within(table).getByRole('rowheader', { name: 'Nov 8' })).toBeInTheDocument();
  });

  it('labels hourly buckets in UTC for the 24 hour window', () => {
    expect(bucketLabel(new Date('2026-11-08T12:00:00Z'), 3_600_000, 3)).toBe('15:00 UTC');
  });
});

describe('HealthPanel', () => {
  const backlog = { ready: 3, leased: 1, deadLetters: 2, quarantined: 1, oldestReadyAgeMs: 90_000 };

  it('names the lane state in text, not colour alone', () => {
    const { unmount } = render(<HealthPanel data={{ lane: { status: 'healthy' }, backlog }} />);
    expect(screen.getByText('Lane: Healthy')).toBeInTheDocument();
    expect(within(tile('Oldest waiting')).getByText('2 min')).toBeInTheDocument();
    unmount();
    render(
      <HealthPanel
        data={{ lane: { status: 'degraded', error: 'Paused to protect paging' }, backlog }}
      />
    );
    expect(screen.getByText('Lane: Degraded')).toBeInTheDocument();
    expect(screen.getByText('Paused to protect paging')).toBeInTheDocument();
  });
});

describe('overview primitives', () => {
  it('marks the selected window as the current page and keeps the visible label in the name', () => {
    render(<WindowSelector current="24h" />);
    const nav = screen.getByRole('navigation', { name: 'Time window' });
    const current = within(nav).getByRole('link', { current: 'page' });
    expect(current).toHaveAttribute('href', '/intelligence?window=24h');
    expect(current).toHaveAccessibleName('24h (last 24 hours)');
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
  });

  it('renders inline errors as alerts and skeletons as busy regions', () => {
    render(
      <>
        <SectionError message="The noise section could not be loaded." />
        <SectionSkeleton title="Noise" />
      </>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The noise section could not be loaded.');
    expect(screen.getByRole('region', { name: 'Loading Noise' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
  });

  it('shows the how-to only to administrators', () => {
    render(<FeatureOff title="Off" adminHint="Do this" href="/x" canManage={false} />);
    expect(screen.queryByText('Do this')).toBeNull();
  });

  it('computes signed relative deltas', () => {
    expect(relativeDelta(50, 100, { lowerIsBetter: true, period: '7d' })).toEqual({
      text: '−50% vs previous 7d',
      direction: 'down',
      tone: 'good',
    });
    expect(relativeDelta(5, 0, { lowerIsBetter: true, period: '7d' })).toBeNull();
    expect(relativeDelta(null, 3, { lowerIsBetter: true, period: '7d' })).toBeNull();
    expect(relativeDelta(100, 100, { lowerIsBetter: true, period: '7d' })?.tone).toBe('neutral');
  });
});
