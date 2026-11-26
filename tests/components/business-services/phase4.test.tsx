import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import type { ImpactTimelineEntry } from '@/lib/business-services/contract';
import ImpactTimeline, {
  TIMELINE_CAP,
  dailyImpactMinutes,
} from '@/components/business-service/ImpactTimeline';
import HealthDistribution from '@/components/business-service/HealthDistribution';
import SavedViews from '@/components/business-service/SavedViews';
import WhyStatusCard from '@/components/business-service/WhyStatusCard';
import ActivityPanel from '@/components/business-service/ActivityPanel';
import BusinessServiceForm from '@/components/service/BusinessServiceForm';
import { previewSentence } from '@/components/service/BusinessServiceFormExtras';
import { formValueFromTemplate } from '@/components/service/business-service-form-defaults';
import { distribution, parseCatalogParams } from '@/components/business-service/catalog-model';
import { diffAuditDetails } from '@/lib/business-services/audit-diff';
import { countAgainstDraft } from '@/lib/business-services/impact-preview';

const { unmark, create } = vi.hoisted(() => ({ unmark: vi.fn(), create: vi.fn() }));
vi.mock('@/app/(app)/services/business/actions', () => ({
  unmarkImpactAction: unmark,
  createBusinessServiceAction: create,
  updateBusinessServiceAction: vi.fn(),
  deleteBusinessServiceAction: vi.fn(),
  searchBusinessServiceOptionsAction: vi.fn().mockResolvedValue([]),
  previewBusinessServiceImpactAction: vi.fn().mockResolvedValue({
    windowDays: 30,
    counted: 2,
    total: 5,
    truncated: false,
  }),
  listTeamServicesAction: vi.fn().mockResolvedValue({ options: [], truncated: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));

const DAY = 86_400_000;
const now = new Date('2026-11-22T12:00:00Z');
const window = { from: new Date(now.getTime() - 30 * DAY), to: now };
const entry = (over: Partial<ImpactTimelineEntry> = {}): ImpactTimelineEntry => ({
  incidentId: 'i1',
  incidentTitle: 'Card auth failing',
  urgency: 'MEDIUM',
  source: 'MANUAL',
  excluded: false,
  startedAt: new Date(now.getTime() - 2 * DAY),
  endedAt: new Date(now.getTime() - 2 * DAY + 3_600_000),
  ...over,
});

beforeEach(() => {
  unmark.mockReset().mockResolvedValue({ ok: true, id: 'bs1' });
  globalThis.localStorage?.clear();
});

describe('ImpactTimeline interaction', () => {
  it('is one chart with one tab stop: arrow keys move between days and select them', () => {
    render(<ImpactTimeline entries={[entry()]} window={window} showIncidents now={now} />);
    const group = screen.getByRole('group', { name: /1 impact in the last 30 days/ });
    const days = within(group).getAllByRole('button');
    expect(days).toHaveLength(30);
    expect(days.filter(day => day.tabIndex === 0)).toHaveLength(1);
    // The impact started two days ago: its column holds the tab stop.
    const impacted = days.find(day => day.tabIndex === 0)!;
    expect(impacted.getAttribute('aria-label')).toMatch(/1h 0m of impact, worst partial outage/);
    expect(impacted.getAttribute('title')).toMatch(/UTC/);
    fireEvent.keyDown(impacted, { key: 'ArrowRight' });
    const next = days[days.indexOf(impacted) + 1]!;
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('tabindex', '0');
    expect(next).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists a selected day and asks before a responder unmarks a manual impact', async () => {
    render(
      <ImpactTimeline
        entries={[entry()]}
        window={window}
        showIncidents
        businessServiceId="bs1"
        canUnmark
        now={now}
      />
    );
    const group = screen.getByRole('group', { name: /impact in the last 30 days/ });
    fireEvent.click(
      within(group)
        .getAllByRole('button')
        .find(day => day.tabIndex === 0)!
    );
    expect(screen.getByTestId('impact-detail')).toHaveTextContent('Card auth failing');
    fireEvent.click(screen.getByRole('button', { name: 'Unmark' }));
    expect(unmark).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unmark impact' }));
    await waitFor(() => expect(unmark).toHaveBeenCalledWith('i1', 'bs1'));
  });

  it('hides Unmark from readers who cannot manage, and warns when the list was cut', () => {
    const many = Array.from({ length: TIMELINE_CAP }, (_, i) =>
      entry({ incidentId: `i${i}`, source: 'MANUAL' })
    );
    render(<ImpactTimeline entries={many} window={window} showIncidents now={now} />);
    expect(screen.queryByRole('button', { name: 'Unmark' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(`newest ${TIMELINE_CAP}`);
  });

  it('offers the 7/30/90 window switch as links', () => {
    render(
      <ImpactTimeline
        entries={[]}
        window={window}
        showIncidents
        now={now}
        ranges={[7, 30, 90].map(days => ({ days, href: `?impact=${days}`, current: days === 30 }))}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Impact window' });
    expect(within(nav).getByRole('link', { name: '30 days' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(within(nav).getByRole('link', { name: '7 days' })).toHaveAttribute('href', '?impact=7');
  });

  it('counts overlapping impact once per day', () => {
    const minutes = dailyImpactMinutes(
      [
        entry({
          startedAt: new Date('2026-11-21T10:00:00Z'),
          endedAt: new Date('2026-11-21T11:00:00Z'),
        }),
        entry({
          startedAt: new Date('2026-11-21T10:30:00Z'),
          endedAt: new Date('2026-11-21T11:30:00Z'),
        }),
      ],
      window,
      now
    );
    expect(minutes.at(-2)).toBe(90);
  });
});

describe('catalog health distribution and saved views', () => {
  const rows = [
    { id: 'a', criticality: 'TIER_0' as const },
    { id: 'b', criticality: 'TIER_0' as const },
    { id: 'c', criticality: null },
  ];
  const health = new Map([
    ['a', { status: 'MAJOR_OUTAGE' as const }],
    ['b', { status: 'OPERATIONAL' as const }],
    ['c', { status: 'OPERATIONAL' as const }],
  ]);

  it('counts by status and by tier, and links each cell to a filter that keeps the search and team', () => {
    const data = distribution(rows, health);
    expect(data.byStatus.OPERATIONAL).toBe(2);
    expect(data.matrix.map(r => [r.tier, r.total])).toEqual([
      ['TIER_0', 2],
      [null, 1],
    ]);
    render(
      <HealthDistribution
        data={data}
        query={{ ...parseCatalogParams().query, q: 'pay', team: 't1', sort: 'tier_asc' }}
      />
    );
    // The health chips live in the filter bar; the distribution has none of its own.
    expect(screen.queryByRole('list', { name: 'Filter by health' })).toBeNull();
    expect(screen.getByRole('link', { name: '1 Tier 0, major outage' })).toHaveAttribute(
      'href',
      '/services/business?q=pay&tier=TIER_0&status=MAJOR_OUTAGE&team=t1&sort=tier_asc'
    );
  });

  it('folds the tier matrix away when nothing is impacted', () => {
    const calm = distribution(rows, new Map([['a', { status: 'OPERATIONAL' as const }]]));
    const { container } = render(
      <HealthDistribution data={calm} query={parseCatalogParams().query} />
    );
    expect(container.querySelector('details')).not.toBeNull();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText('All 3 without impact')).toBeInTheDocument();
  });

  it('saves the current filters as a named view and removes it again', async () => {
    render(<SavedViews userId="u1" currentHref="/services/business?tier=TIER_0" filtered />);
    fireEvent.click(screen.getByRole('button', { name: 'Save this view' }));
    const input = screen.getByLabelText('Name for this view');
    fireEvent.change(input, { target: { value: 'Tier 0' } });
    fireEvent.submit(input.closest('form')!);
    const link = await screen.findByRole('link', { name: 'Tier 0' });
    expect(link).toHaveAttribute('href', '/services/business?tier=TIER_0');
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved view Tier 0' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Tier 0' })).toBeNull());
  });
});

describe('detail cards', () => {
  it('links a reason to its incident and leaves others as text', () => {
    render(
      <WhyStatusCard
        status="DEGRADED"
        reasons={[
          { text: 'API has an open incident.', href: '/incidents/i9' },
          { text: 'Maintenance.' },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: /API has an open incident/ })).toHaveAttribute(
      'href',
      '/incidents/i9'
    );
    expect(screen.getByText('Maintenance.')).toBeInTheDocument();
  });

  it('diffs the before and after snapshot and names owners', () => {
    const details = {
      newValue: {
        criticality: 'TIER_0',
        ownerTeamId: 't2',
        memberServiceIds: ['a', 'b'],
        before: { criticality: 'TIER_2', ownerTeamId: 't1', memberServiceIds: ['a'] },
      },
    };
    const changes = diffAuditDetails(
      details,
      new Map([
        ['t1', 'Payments'],
        ['t2', 'Platform'],
      ])
    );
    expect(changes.map(c => `${c.label}:${c.from}>${c.to}`)).toEqual([
      'Criticality:TIER_2>TIER_0',
      'Owner team:Payments>Platform',
      'Services:1>2 (1 added, 0 removed)',
    ]);
    expect(diffAuditDetails({ newValue: { name: 'x' } })).toEqual([]);
    render(
      <ActivityPanel
        entries={[
          {
            id: '1',
            action: 'business_service.updated',
            actorName: 'Ada',
            createdAt: now,
            details,
          },
        ]}
        names={new Map()}
      />
    );
    expect(screen.getByRole('list', { name: 'Activity' })).toHaveTextContent('Updated by Ada');
  });
});

describe('form', () => {
  it('shows field errors under the field, a summary with anchors, and focuses the first invalid field', async () => {
    render(<BusinessServiceForm services={[]} teams={[]} users={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create business service' }));
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'bs-name-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Fix 1 field before saving.');
    expect(screen.getByRole('link', { name: 'Give the business service a name.' })).toHaveAttribute(
      'href',
      '#bs-name'
    );
    await waitFor(() => expect(name).toHaveFocus());
  });

  it('edits links as rows and tags as chips, and sends them in the stored shape', async () => {
    create.mockResolvedValue({ ok: true, id: 'new' });
    render(<BusinessServiceForm services={[]} teams={[]} users={[]} />);
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Checkout' } });
    fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: 'Runbook' } });
    fireEvent.change(screen.getByLabelText('Link 1 URL'), {
      target: { value: 'https://wiki.example.com/rb' },
    });
    const tags = screen.getByLabelText('Tags');
    fireEvent.change(tags, { target: { value: 'pci' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    fireEvent.change(tags, { target: { value: 'payments' } });
    fireEvent.keyDown(tags, { key: ',' });
    expect(screen.getByRole('button', { name: 'Remove tag pci' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create business service' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      links: [{ label: 'Runbook', url: 'https://wiki.example.com/rb' }],
      tags: ['pci', 'payments'],
    });
  });

  it('marks unsaved changes, links Cancel to the detail page when editing, and has a danger zone', () => {
    render(
      <BusinessServiceForm
        services={[{ id: 's1', name: 'API' }]}
        teams={[]}
        users={[]}
        canDelete
        initial={{
          ...formValueFromTemplate({ tags: [], lifecycle: 'ACTIVE' } as never),
          id: 'bs1',
          name: 'Checkout',
          memberServiceIds: ['s1'],
        }}
      />
    );
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/services/business/bs1'
    );
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    // The member row's critical control is a labelled switch, not a struck-through button.
    const critical = screen.getByRole('switch', { name: /API is critical/ });
    expect(critical).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(critical);
    expect(screen.getByRole('switch', { name: /API is critical/ })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByText('Non-critical')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    // In-app links now ask first.
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Leave with unsaved changes?');
  });

  it('keeps quorum and hops under Advanced, and opens it for an error there', async () => {
    const { container } = render(<BusinessServiceForm services={[]} teams={[]} users={[]} />);
    const details = container.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Partial at (% down)'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create business service' }));
    await waitFor(() => expect(details).toHaveAttribute('open'));
  });

  it('previews what the thresholds would count', async () => {
    render(
      <BusinessServiceForm
        services={[]}
        teams={[]}
        users={[]}
        initial={{
          ...formValueFromTemplate({ tags: [], lifecycle: 'ACTIVE' } as never),
          name: 'x',
          memberServiceIds: ['s1'],
        }}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('impact-preview')).toHaveTextContent('2 of 5 incidents')
    );
  });

  it('words the preview, with a floor when truncated', () => {
    expect(previewSentence({ windowDays: 30, counted: 1, total: 4, truncated: true })).toContain(
      'at least 1 of at least 4'
    );
    expect(
      countAgainstDraft(
        [
          { urgency: 'LOW', priority: 'P1' },
          { urgency: 'LOW', priority: null },
        ],
        { criticality: 'TIER_2', impactMinUrgency: null, impactMaxPriority: null }
      )
    ).toBe(1);
  });
});
