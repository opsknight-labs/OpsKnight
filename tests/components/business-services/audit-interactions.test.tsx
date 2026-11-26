import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/services/business/x',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));
const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: notifyMock }));

const follow = vi.fn();
vi.mock('@/app/(app)/services/business/actions', () => ({
  followBusinessServiceAction: (...a: unknown[]) => follow(...a),
}));
const phase5b = vi.hoisted(() => ({
  bulkEditAction: vi.fn(),
  addCustomerReportAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  createTemplateAction: vi.fn(),
  updateTemplateAction: vi.fn(),
  setHygieneEnabledAction: vi.fn(),
}));
vi.mock('@/app/(app)/services/business/phase5b-actions', () => phase5b);

import SavedViews from '@/components/business-service/SavedViews';
import HealthDistribution from '@/components/business-service/HealthDistribution';
import BusinessServiceFollowButton from '@/components/service/BusinessServiceFollowButton';
import TemplateManager, { type TemplateView } from '@/components/business-service/TemplateManager';
import AddCustomerReportForm from '@/components/business-service/AddCustomerReportForm';
import HygieneToggle from '@/components/business-service/HygieneToggle';
import BulkEditBar from '@/components/business-service/BulkEditBar';
import CatalogDirectory, { type CatalogRow } from '@/components/business-service/CatalogDirectory';
import DependencyHealthSummary from '@/components/business-service/DependencyHealthSummary';
import WhyStatusCard from '@/components/business-service/WhyStatusCard';
import ImpactBars from '@/components/analytics/ImpactBars';
import DetailTabs from '@/components/ui/DetailTabs';
import {
  countMatching,
  distribution,
  parseCatalogParams,
} from '@/components/business-service/catalog-model';
import type { ImpactReportRow } from '@/lib/business-services/impact-report';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('SavedViews', () => {
  it('saves a view, announces it and keeps focus in the group', () => {
    render(<SavedViews userId="u1" currentHref="/services/business?status=impacted" filtered />);
    fireEvent.click(screen.getByRole('button', { name: 'Save this view' }));
    fireEvent.change(screen.getByLabelText('Name for this view'), { target: { value: 'Down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('link', { name: 'Down' })).toHaveAttribute(
      'href',
      '/services/business?status=impacted'
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved view Down');
    expect(screen.getByRole('group', { name: 'Saved views' })).toHaveFocus();
  });

  it('removes a view and ignores stored hrefs that are not the catalog', () => {
    window.localStorage.setItem(
      'opsknight:bs-catalog-views:u1',
      JSON.stringify([
        { name: 'Ok', href: '/services/business?tier=TIER_0' },
        { name: 'Bare', href: '/services/business' },
        { name: 'Sneaky', href: '/services/businessX' },
        { name: 'Other', href: 'https://evil.example' },
      ])
    );
    render(<SavedViews userId="u1" currentHref="/services/business" filtered={false} />);
    expect(screen.getByRole('link', { name: 'Ok' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bare' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sneaky' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Other' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved view Ok' }));
    expect(screen.queryByRole('link', { name: 'Ok' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Removed saved view Ok');
  });
});

describe('HealthDistribution', () => {
  it('links non-empty cells to their filter and reads empty cells as "none", not as an aria-label on a span', () => {
    const data = distribution(
      [
        { id: 'a', criticality: 'TIER_0' },
        { id: 'b', criticality: 'TIER_0' },
        { id: 'c', criticality: null },
      ],
      new Map([
        ['a', { status: 'MAJOR_OUTAGE' as const }],
        ['b', { status: 'OPERATIONAL' as const }],
        // c has no health: counted as UNKNOWN
      ])
    );
    const { container } = render(
      <HealthDistribution data={data} query={parseCatalogParams().query} />
    );
    expect(data.byStatus.UNKNOWN).toBe(1);
    expect(container.querySelector('span[aria-label="none"]')).toBeNull();
    expect(container.textContent).toMatch(/none/);
    const link = screen.getByRole('link', { name: '1 Tier 0, major outage' });
    expect(link.getAttribute('href')).toContain('status=MAJOR_OUTAGE');
  });
});

describe('catalog UNKNOWN health', () => {
  it('counts a service with no health as UNKNOWN when filtering by UNKNOWN', () => {
    const rows = [
      {
        id: 'a',
        name: 'A',
        description: null,
        criticality: null,
        ownerTeamId: null,
        ownerUserId: null,
        memberCount: 0,
      },
    ];
    const query = parseCatalogParams({ status: 'UNKNOWN' }).query;
    expect(query.status).toBe('UNKNOWN');
    expect(countMatching(rows, new Map(), query)).toBe(1);
    expect(
      countMatching(rows, new Map(), parseCatalogParams({ status: 'OPERATIONAL' }).query)
    ).toBe(0);
  });
});

describe('BusinessServiceFollowButton', () => {
  it('toggles optimistically and reports a refused follow', async () => {
    follow.mockResolvedValue({ ok: false, error: 'Nope' });
    render(<BusinessServiceFollowButton id="b1" name="Checkout" following={false} />);
    const button = screen.getByRole('button', { name: 'Follow Checkout' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    await waitFor(() => expect(follow).toHaveBeenCalledWith('b1', true));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalledWith('Nope'));
  });
});

const template: TemplateView = {
  id: 't1',
  name: 'API',
  description: null,
  criticality: 'TIER_1',
  sloTarget: 99.9,
  sloWindowDays: 30,
  tags: [],
  environment: null,
  lifecycle: 'ACTIVE',
  ownerTeamId: null,
  ownerTeamName: null,
};

describe('TemplateManager', () => {
  it('asks before deleting and does not call the server on Cancel', async () => {
    render(<TemplateManager templates={[template]} teams={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete template API' }));
    expect(phase5b.deleteTemplateAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(phase5b.deleteTemplateAction).not.toHaveBeenCalled();
  });

  it('deletes after confirmation', async () => {
    phase5b.deleteTemplateAction.mockResolvedValue({ ok: true });
    render(<TemplateManager templates={[template]} teams={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete template API' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(phase5b.deleteTemplateAction).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('moves focus to the form when editing and names the row actions', () => {
    render(<TemplateManager templates={[template]} teams={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit template API' }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Use template API' })).toBeInTheDocument();
  });
});

describe('AddCustomerReportForm', () => {
  it('rejects bad input without calling the server', () => {
    render(<AddCustomerReportForm businessServiceId="b1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number/);
    expect(phase5b.addCustomerReportAction).not.toHaveBeenCalled();
  });

  it('shows a failed result as an error instead of throwing', async () => {
    phase5b.addCustomerReportAction.mockResolvedValue({ ok: false, error: 'Too many reports' });
    render(<AddCustomerReportForm businessServiceId="b1" />);
    fireEvent.change(screen.getByLabelText('Customer reports'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reports');
  });
});

describe('HygieneToggle', () => {
  it('rolls back and reports when the server refuses', async () => {
    phase5b.setHygieneEnabledAction.mockResolvedValue({ ok: false, error: 'Admins only' });
    render(<HygieneToggle enabled={false} />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalledWith('Admins only'));
    await waitFor(() =>
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    );
  });

  it('follows the prop when the server value changes', () => {
    const { rerender } = render(<HygieneToggle enabled={false} />);
    rerender(<HygieneToggle enabled />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

const row = (id: string): CatalogRow => ({
  id,
  name: `Service ${id}`,
  description: null,
  criticality: null,
  ownerTeam: null,
  status: 'OPERATIONAL',
  since: null,
  memberCount: 1,
  impactedMemberCount: 0,
  openIncidentCount: 0,
  followerCount: 0,
  following: false,
});
const pagination = { page: 1, pageSize: 2, totalCount: 4 };

describe('CatalogDirectory selection', () => {
  it('drops selected ids that are no longer on the page', () => {
    const props = { pagination, filtered: false, clearHref: '/services/business', canManage: true };
    const { rerender } = render(<CatalogDirectory {...props} rows={[row('a'), row('b')]} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Service a' })[0]);
    expect(screen.getByRole('region', { name: 'Bulk edit' })).toHaveTextContent('1 selected');
    rerender(<CatalogDirectory {...props} rows={[row('c'), row('d')]} />);
    expect(screen.queryByRole('region', { name: 'Bulk edit' })).toBeNull();
  });

  it('has no sort buttons: the directory is keyset-paged, a client sort only reorders one page', () => {
    render(
      <CatalogDirectory
        rows={[row('a'), row('b')]}
        pagination={pagination}
        filtered={false}
        clearHref="/services/business"
        canManage={false}
      />
    );
    const table = screen.getByRole('table', { name: 'Business services' });
    expect(within(table).queryAllByRole('button', { name: /sort/i })).toHaveLength(0);
  });
});

describe('BulkEditBar', () => {
  const bar = () => (
    <BulkEditBar ids={['a']} names={new Map([['a', 'A']])} teams={[]} onClear={vi.fn()} />
  );
  it('only enables Apply after a preview of the current changes, and drops a stale preview', async () => {
    phase5b.bulkEditAction.mockResolvedValue({
      ok: true,
      dryRun: true,
      summary: { ok: 1, failed: 0 },
      results: [{ id: 'a', ok: true }],
    });
    render(bar());
    const apply = () => screen.getByRole('button', { name: 'Apply to 1' });
    expect(apply()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Add tags'), { target: { value: 'pci' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Preview: 1 ok/)).toBeInTheDocument();
    await waitFor(() => expect(apply()).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Add tags'), { target: { value: 'pci, legacy' } });
    expect(screen.queryByText(/Preview: 1 ok/)).toBeNull();
    expect(apply()).toBeDisabled();
  });

  it('can clear the SLO target', async () => {
    phase5b.bulkEditAction.mockResolvedValue({
      ok: true,
      dryRun: true,
      summary: { ok: 1, failed: 0 },
      results: [{ id: 'a', ok: true }],
    });
    render(bar());
    fireEvent.click(screen.getByLabelText('Clear SLO target'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(phase5b.bulkEditAction).toHaveBeenCalledWith({
        ids: ['a'],
        changes: { sloTarget: null },
        dryRun: true,
      })
    );
  });
});

describe('DependencyHealthSummary', () => {
  it('does not call unknown, unloaded or maintenance dependencies healthy', () => {
    render(
      <DependencyHealthSummary
        supporting={[
          { status: 'OPERATIONAL' },
          { status: null },
          { status: 'UNKNOWN' },
          { status: 'MAINTENANCE' },
        ]}
        technicalCount={0}
        tabHref="/x"
      />
    );
    expect(screen.getByText('1 healthy, 3 unknown or in maintenance')).toBeInTheDocument();
  });
});

describe('WhyStatusCard', () => {
  it('explains an operational status instead of rendering nothing', () => {
    render(<WhyStatusCard status="OPERATIONAL" reasons={[]} />);
    expect(screen.getByText('Why this status')).toBeInTheDocument();
    expect(screen.getByText('Nothing is affecting it right now.')).toBeInTheDocument();
  });
});

describe('ImpactBars', () => {
  const impact = (id: string, impactMinutes: number) =>
    ({ id, name: id, stats: { impactMinutes } }) as unknown as ImpactReportRow;
  it('ranks by impacted time and never exceeds 100% when the report is sorted by cost', () => {
    const { container } = render(
      <ImpactBars rows={[impact('small', 30), impact('big', 600), impact('mid', 120)]} />
    );
    const names = [...container.querySelectorAll('li > span.truncate')].map(n => n.textContent);
    expect(names).toEqual(['big', 'mid', 'small']);
    const widths = [...container.querySelectorAll<HTMLElement>('li [style]')].map(n =>
      parseFloat(n.style.width)
    );
    expect(Math.max(...widths)).toBeLessThanOrEqual(100);
    expect(widths[0]).toBe(100);
  });
});

describe('DetailTabs', () => {
  const tabs = [
    { id: 'overview', label: 'Overview', content: <p>overview body</p> },
    { id: 'members', label: 'Members', content: null },
  ];
  it('falls back to the first tab for a defaultTab that is not offered', () => {
    render(<DetailTabs tabs={tabs} defaultTab="activity" syncWithUrl={false} label="Sections" />);
    expect(screen.getByText('overview body')).toBeInTheDocument();
  });

  it('shows a loading placeholder, not a blank card, while a server tab loads', () => {
    render(<DetailTabs tabs={tabs} navigationMode="server" label="Sections" />);
    act(() => {
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Members' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Members' }));
    });
    expect(screen.getByRole('status', { name: 'Loading Members' })).toBeInTheDocument();
  });
});
