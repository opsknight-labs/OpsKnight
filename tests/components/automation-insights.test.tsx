import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AutomationWorkspace from '@/components/automation/AutomationWorkspace';
import { ConfigurationHealth } from '@/components/automation/ConfigurationHealth';
import { nameAutomationInsight } from '@/components/automation/AutomationInsights';
import { emptySnapshot, type Rule } from '@/lib/automation/contract';
import { suggestedRuleHref } from '@/lib/automation/suggested-rule';
import type { OpsInsightView } from '@/lib/intelligence/ops-insights/contract';

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/services/service',
  useSearchParams: () => nav.params,
}));
vi.mock('@/app/(app)/intelligence/insight-actions', () => ({ decideInsightAction: vi.fn() }));
const api = vi.hoisted(() => ({ action: vi.fn(), area: vi.fn() }));
vi.mock('@/app/(app)/services/[id]/automation/actions', () => ({
  automationAction: api.action,
  getAutomationArea: api.area,
  getAutomationVersionSnapshot: vi.fn(),
}));

const rule: Rule = {
  id: 'r-db',
  name: 'Page the DB team',
  phase: 'ROUTE',
  enabled: true,
  conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'db' }],
  actions: [{ type: 'USE_SERVICE_DEFAULT' }],
};

const insight = (key: string, title: string, kind = 'automation.rule_health'): OpsInsightView => ({
  id: key,
  scopeType: 'SERVICE',
  scopeId: 'service',
  kind,
  key,
  area: 'automation',
  severity: 'WARNING',
  status: 'OPEN',
  title,
  summary: 'Summary.',
  evidence: { facts: [{ label: 'Incidents routed', value: '50' }] },
  draftHref: '/services/service?tab=automation&automationRule=r-db',
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
});

beforeEach(() => {
  localStorage.clear();
  nav.params = new URLSearchParams();
  nav.replace.mockReset();
  api.area.mockReset();
  api.action.mockReset();
});

it('puts rule and field names back into rule-health titles for automation readers', () => {
  const fields = [{ key: 'environment', label: 'Environment' }];
  expect(
    nameAutomationInsight(
      insight('shadowed:r-db', 'A route rule is always decided by an earlier rule'),
      [rule],
      fields
    ).title
  ).toBe('“Page the DB team” is always decided by an earlier rule');
  expect(
    nameAutomationInsight(
      insight('overridden:r-db', 'Responders often correct incidents routed by a route rule'),
      [rule],
      fields
    ).title
  ).toBe('Responders often correct incidents routed by “Page the DB team”');
  expect(
    nameAutomationInsight(
      insight('unmapped:environment', 'A context field is unmapped for 60% of incidents'),
      [rule],
      fields
    ).title
  ).toBe('“Environment” is unmapped for 60% of incidents');
  // A rule that is no longer in the draft keeps the generic wording.
  expect(
    nameAutomationInsight(
      insight('shadowed:gone', 'A route rule is always decided by an earlier rule'),
      [rule],
      fields
    ).title
  ).toBe('A route rule is always decided by an earlier rule');
});

it('shows rule health from real traffic in ConfigurationHealth even when the static checks pass', () => {
  const { rerender } = render(<ConfigurationHealth issues={[]} rules={[rule]} />);
  expect(screen.queryByRole('region', { name: 'Configuration health' })).toBeNull();

  rerender(
    <ConfigurationHealth
      issues={[]}
      rules={[rule]}
      insights={{
        items: [
          insight('shadowed:r-db', 'A route rule is always decided by an earlier rule'),
          insight('rule:x', 'Suggested rule: set P1', 'automation.suggested_rule'),
        ],
        canDecide: true,
        squireName: null,
      }}
    />
  );
  const region = screen.getByRole('region', { name: 'Configuration health' });
  const list = within(region).getByRole('list', { name: 'Rule health from real traffic' });
  expect(list).toHaveTextContent('“Page the DB team” is always decided by an earlier rule');
  // Suggestions live on the Overview, not in the health panel.
  expect(region).not.toHaveTextContent('Suggested rule');
  expect(within(region).getByRole('link', { name: /Open rule/ })).toHaveAttribute(
    'href',
    '/services/service?tab=automation&automationRule=r-db'
  );
});

it('opens a suggested rule from its link and adds it to the draft only when asked', async () => {
  const href = suggestedRuleHref('service', {
    name: 'Set P1 when severity is critical',
    conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'critical' }],
    priority: 'P1',
  })!;
  nav.params = new URL(href, 'https://app.example').searchParams;
  api.area.mockResolvedValue({
    enabled: true,
    mode: 'SHADOW',
    canPublish: true,
    canEdit: true,
    canReadSensitive: true,
    activeVersionId: null,
    activeVersion: null,
    draft: { snapshot: { ...emptySnapshot, rules: [rule] }, revision: 1 },
    insights: { items: [], canDecide: false, squireName: null },
    aggregates: [],
    traces: [],
    policies: [],
    destinations: [],
    integrations: [],
    alerts: [],
    observations: [],
    versions: [],
    versionTotal: 0,
    unmappedCount: 0,
  });
  api.action.mockResolvedValue({ ok: true, data: { revision: 2 } });
  render(<AutomationWorkspace serviceId="service" />);

  const notice = await screen.findByText(/Nothing is saved until you add it/);
  expect(notice).toHaveTextContent('when severity is critical, set priority P1');
  expect(
    screen.queryByRole('button', { name: 'Configure Set P1 when severity is critical' })
  ).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  expect(
    await screen.findByRole('button', { name: 'Configure Set P1 when severity is critical' })
  ).toBeInTheDocument();
  expect(nav.replace).toHaveBeenCalledWith('/services/service?tab=automation', { scroll: false });
});
