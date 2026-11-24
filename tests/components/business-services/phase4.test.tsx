import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { distribution } from '@/components/business-service/catalog-model';
import { diffAuditDetails } from '@/lib/business-services/audit-diff';
import { countAgainstDraft } from '@/lib/business-services/impact-preview';

const { unmark } = vi.hoisted(() => ({ unmark: vi.fn() }));
vi.mock('@/app/(app)/services/business/actions', () => ({
  unmarkImpactAction: unmark,
  createBusinessServiceAction: vi.fn(),
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
  window.localStorage?.clear();
});

describe('ImpactTimeline interaction', () => {
  it('shows details on keyboard focus and lets a responder unmark a manual impact', async () => {
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
    const bar = screen.getByRole('button', { name: /Partial outage, Marked by a responder/ });
    fireEvent.focus(bar);
    expect(screen.getByTestId('impact-detail')).toHaveTextContent('Card auth failing');
    fireEvent.click(screen.getByRole('button', { name: 'Unmark' }));
    expect(unmark).toHaveBeenCalledWith('i1', 'bs1');
  });

  it('hides Unmark from readers who cannot manage, and warns when the list was cut', () => {
    const many = Array.from({ length: TIMELINE_CAP }, (_, i) =>
      entry({ incidentId: `i${i}`, source: 'DIRECT' })
    );
    render(<ImpactTimeline entries={many} window={window} showIncidents now={now} />);
    fireEvent.focus(screen.getAllByRole('button', { name: /Partial outage/ })[0]!);
    expect(screen.queryByRole('button', { name: 'Unmark' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(`newest ${TIMELINE_CAP}`);
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

  it('counts by status and by tier, and links every chip and cell to a filter', () => {
    const data = distribution(rows, health);
    expect(data.byStatus.OPERATIONAL).toBe(2);
    expect(data.matrix.map(r => [r.tier, r.total])).toEqual([
      ['TIER_0', 2],
      [null, 1],
    ]);
    render(
      <HealthDistribution
        data={data}
        query={{ q: '', tier: '', status: 'MAJOR_OUTAGE', team: '', needs: '' }}
      />
    );
    const chip = screen.getByRole('link', { name: /Major outage 1/ });
    expect(chip).toHaveAttribute('href', '/services/business?status=MAJOR_OUTAGE');
    expect(chip).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: '1 Tier 0, major outage' })).toHaveAttribute(
      'href',
      '/services/business?tier=TIER_0&status=MAJOR_OUTAGE'
    );
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
