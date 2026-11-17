import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/schedules/s1',
}));
vi.mock('@/lib/oncall-load/store', () => ({
  loadScheduleLoad: vi.fn(),
  loadMyOnCallLoad: vi.fn(),
}));
vi.mock('@/lib/intelligence/ops-insights/view', () => ({ listInsightsForScope: vi.fn() }));
vi.mock('@/app/(app)/intelligence/insight-actions', () => ({ decideInsightAction: vi.fn() }));

import ScheduleCard from '@/components/ScheduleCard';
import { MyOnCallLoadBody } from '@/components/schedules/MyOnCallLoadCard';
import ScheduleDetailTabs from '@/components/schedules/ScheduleDetailTabs';
import { ScheduleLoadBody } from '@/components/schedules/ScheduleLoadPanel';
import type { ScheduleLoadView } from '@/lib/oncall-load/store';
import type { PersonLoad } from '@/lib/oncall-load/metrics';

const person = (overrides: Partial<PersonLoad> = {}): PersonLoad => ({
  userId: 'u1',
  pages: 12,
  nightPages: 5,
  weekendPages: 2,
  interruptedHours: 9,
  nightsPaged: 4,
  weeksWithNightPages: 2,
  longestQuietGapHours: 70,
  onCallHours: 168,
  pagesPerOnCallWeek: 12,
  vsRotationMean: 1.8,
  daily: [
    { day: '2026-11-01', pages: 3 },
    { day: '2026-11-02', pages: 9 },
  ],
  ...overrides,
});

const view = (overrides: Partial<ScheduleLoadView> = {}): ScheduleLoadView => ({
  windowDays: 28,
  rotationSize: 3,
  people: [{ ...person(), name: 'Ana' }],
  rotation: { totalPages: 20, meanPagesPerOnCallWeek: 6.7, fairnessIndex: 0.62 },
  ...overrides,
});

describe('ScheduleLoadBody', () => {
  it('shows rotation totals and one row per visible person with their heat strip', () => {
    const { container } = render(<ScheduleLoadBody load={view()} insights={null} />);
    const stats = container.querySelector('dl[aria-label="Rotation load"]') as HTMLElement;
    expect(within(stats).getByText('20')).toBeInTheDocument();
    expect(screen.getByText('0.62')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Ana/ });
    expect(within(row).getByText('1.8×')).toBeInTheDocument();
    expect(within(row).getByText('3d')).toBeInTheDocument(); // 70 h quiet gap
    expect(within(row).getByText('7d')).toBeInTheDocument(); // 168 h on call
    expect(
      screen.getByRole('img', { name: 'Pages per day for Ana: 12 from Nov 1 to Nov 2' })
    ).toBeInTheDocument();
    // The table scrolls sideways on a phone, so its scroll area takes keyboard focus.
    expect(screen.getByRole('region', { name: /^Load per person/ })).toHaveAttribute(
      'tabindex',
      '0'
    );
  });

  it('explains hidden totals instead of revealing a two-person rotation', () => {
    render(<ScheduleLoadBody load={view({ rotationSize: 2, rotation: null })} insights={null} />);
    expect(screen.getByText(/Rotation totals are hidden: with 2 people/)).toBeInTheDocument();
  });

  it('says who can see rows when the viewer may see nobody', () => {
    render(<ScheduleLoadBody load={view({ people: [] })} insights={null} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/You can see your own load/)).toBeInTheDocument();
  });
});

describe('MyOnCallLoadBody', () => {
  it('renders nothing for someone who was not on call and not paged', () => {
    const { container } = render(
      <MyOnCallLoadBody
        load={{ ...person({ pages: 0, onCallHours: 0, pagesPerOnCallWeek: null }), windowDays: 28 }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the person their own numbers', () => {
    render(<MyOnCallLoadBody load={{ ...person(), windowDays: 28 }} />);
    expect(screen.getByText('My on-call load')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText(/Last 28 days, 168h on call/)).toBeInTheDocument();
  });
});

describe('ScheduleDetailTabs', () => {
  const base = { overview: 'o', rotation: 'r', overrides: 'v', settings: 's' };
  it('leaves the Load & fairness tab out while the switch is off', () => {
    render(<ScheduleDetailTabs {...base} />);
    expect(screen.queryByRole('tab', { name: /Load & fairness/ })).not.toBeInTheDocument();
  });
  it('adds the tab when given its content', () => {
    render(<ScheduleDetailTabs {...base} load="load body" />);
    expect(screen.getByRole('tab', { name: /Load & fairness/ })).toBeInTheDocument();
  });
});

describe('ScheduleCard insight badge', () => {
  const schedule = { id: 's1', name: 'Primary', timeZone: 'UTC', layers: [] };
  it('shows the open-insight count when there is one', () => {
    render(<ScheduleCard schedule={schedule} insights={{ open: 2, highest: 'WARNING' }} />);
    expect(
      screen.getByRole('img', { name: '2 open insights, highest severity warning' })
    ).toBeInTheDocument();
  });
  it('shows no badge without insights', () => {
    render(<ScheduleCard schedule={schedule} />);
    expect(screen.queryByRole('img', { name: /open insight/ })).not.toBeInTheDocument();
  });
});
