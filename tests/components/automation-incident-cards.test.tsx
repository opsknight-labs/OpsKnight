import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, within } from '@testing-library/react';
import type { Field } from '@/lib/automation/contract';

const mocks = vi.hoisted(() => ({
  visible: vi.fn(),
  permissions: vi.fn(),
  decision: vi.fn(),
  notifications: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  assertCanViewIncident: mocks.visible,
  getUserPermissions: mocks.permissions,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    incidentAutomationDecision: { findUnique: mocks.decision },
    notification: { groupBy: mocks.notifications },
  },
}));

import IncidentAutomationCard from '@/components/automation/IncidentAutomationCard';
import IncidentAlertContextCard from '@/components/automation/IncidentAlertContextCard';

const sensitive = { capabilities: ['automation.read', 'incident.sensitive.read'] };
const baseDecision = {
  mode: 'LIVE',
  routeType: 'ESCALATION_POLICY',
  escalationPolicyNameSnapshot: 'Payments primary',
  matchedRouteRuleName: 'Payments P1',
  basePriority: 'P3',
  finalPriority: 'P1',
  fallbackReason: null,
  summary: {},
  version: { versionNumber: 7 },
};

async function renderCard() {
  return renderToStaticMarkup((await IncidentAutomationCard({ incidentId: 'incident' }))!);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.visible.mockResolvedValue(undefined);
  mocks.permissions.mockResolvedValue(sensitive);
  mocks.notifications.mockResolvedValue([]);
  mocks.decision.mockResolvedValue(baseDecision);
});

describe('IncidentAutomationCard at a glance', () => {
  it('shows the pinned policy route, priority change, rule, version and mode', async () => {
    const html = await renderCard();
    expect(html).toContain('id="incident-automation-decision-heading"');
    expect(html).toContain('Automation Decision');
    expect(html).toContain('Policy pinned');
    expect(html).toContain('Matched rule: Payments P1');
    expect(html).toContain('Payments primary');
    expect(html).toContain('(set by automation)');
    expect(html).toContain('v7');
    expect(html).toContain('Live');
  });

  it('does not call a shadow-mode policy selection pinned', async () => {
    mocks.decision.mockResolvedValue({ ...baseDecision, mode: 'SHADOW' });
    const html = await renderCard();
    expect(html).toContain('Policy selected');
    expect(html).not.toContain('Policy pinned');
    expect(html).toContain('Shadow');
  });

  it.each([
    [{ routeType: 'NO_ESCALATION' }, 'No escalation'],
    [{ routeType: 'SERVICE_DEFAULT', matchedRouteRuleName: null }, 'Service default'],
    [
      { routeType: 'SERVICE_DEFAULT', fallbackReason: 'EVALUATION_TIMEOUT' },
      'Fallback · service default',
    ],
  ])('labels the route outcome for %o', async (patch, label) => {
    mocks.decision.mockResolvedValue({ ...baseDecision, ...patch });
    expect(await renderCard()).toContain(label);
  });

  it('keeps the fallback reason and does not mark an unchanged priority as set by automation', async () => {
    mocks.decision.mockResolvedValue({
      ...baseDecision,
      routeType: 'SERVICE_DEFAULT',
      matchedRouteRuleName: null,
      fallbackReason: 'EVALUATION_TIMEOUT',
      finalPriority: 'P3',
    });
    const html = await renderCard();
    expect(html).toContain('Fallback: EVALUATION_TIMEOUT');
    expect(html).toContain('Automation could not be applied; service-default routing was used.');
    expect(html).not.toContain('(set by automation)');
  });

  it('labels every notification status without inferring delivery', async () => {
    mocks.notifications.mockResolvedValue([
      { channel: 'SLACK', status: 'FAILED', _count: { _all: 1 } },
      { channel: 'MICROSOFT_TEAMS', status: 'UNKNOWN', _count: { _all: 2 } },
      { channel: 'SLACK', status: 'SKIPPED', _count: { _all: 3 } },
    ]);
    const html = await renderCard();
    expect(html).toContain('Slack · 1 · Failed');
    expect(html).toContain('Teams · 2 · Delivery uncertain');
    expect(html).toContain('Slack · 3 · Skipped');
    expect(html).not.toContain('Delivery confirmed');
  });

  it('shows an explicit empty evaluation state and a restricted state', async () => {
    expect(await renderCard()).toContain('No evaluation details were stored.');
    mocks.permissions.mockResolvedValue({ capabilities: ['automation.read'] });
    const restricted = await renderCard();
    expect(restricted).toContain('Evaluation context is restricted.');
    expect(restricted).not.toContain('View evaluation');
  });

  it('groups stored evaluation details under labelled sections', async () => {
    mocks.decision.mockResolvedValue({
      ...baseDecision,
      summary: {
        normalization: [{ fieldKey: 'tier', raw: 'gold', canonical: { state: 'UNMAPPED' } }],
        inputContext: { tier: { state: 'UNMAPPED', raw: 'gold' } },
        writes: [{ fieldKey: 'team', value: 'payments' }],
      },
    });
    const html = await renderCard();
    expect(html).toContain('Normalization');
    expect(html).toContain('tier: gold → unmapped');
    expect(html).toContain('Evaluated input');
    expect(html).toContain('tier: gold (unmapped)');
    expect(html).toContain('Context writes');
    expect(html).toContain('team → payments');
  });
});

const field = (key: string, label: string, type: Field['type'] = 'STRING'): Field => ({
  fieldId: key,
  key,
  label,
  type,
  caseSensitive: false,
  aliases: {},
  mappings: [],
});

describe('IncidentAlertContextCard field states', () => {
  const fields = [
    field('environment', 'Environment'),
    field('tier', 'Tier', 'ENUM'),
    field('region', 'Region'),
  ];

  it('shows type, state and source for each field with received and enriched values distinguished', () => {
    render(
      <IncidentAlertContextCard
        fields={fields}
        sensitive
        omitted={false}
        versionNumber={3}
        receivedContext={{
          environment: { state: 'RECOGNIZED', value: 'staging' },
          tier: { state: 'UNMAPPED', raw: 'gold' },
        }}
        context={{
          environment: { state: 'RECOGNIZED', value: 'production' },
          tier: { state: 'UNMAPPED', raw: 'gold' },
        }}
      />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Alert Context' })).toBeTruthy();
    expect(screen.getByText('Automation · v3')).toBeTruthy();

    const environmentCard = screen.getByTestId('alert-context-field-environment');
    const environment = within(environmentCard);
    expect(environmentCard.textContent).toContain('Type: Text');
    expect(environmentCard.textContent).toContain('State: Recognized');
    expect(environmentCard.textContent).toContain('Source: Enriched');
    expect(environment.getByText('staging')).toBeTruthy();
    expect(environment.getByText('production')).toBeTruthy();
    expect(environment.getByText('Received value:')).toBeTruthy();
    expect(environment.getByText('Value after automation:')).toBeTruthy();

    const tier = screen.getByTestId('alert-context-field-tier');
    expect(tier.textContent).toContain('Type: Enum');
    expect(tier.textContent).toContain('State: Unmapped');
    expect(tier.textContent).toContain('Source: Alert');
    expect(within(tier).getByText('Unrecognized value')).toBeTruthy();
    expect(tier.textContent).not.toContain('Received value');

    const region = screen.getByTestId('alert-context-field-region');
    expect(region.textContent).toContain('State: Missing');
    expect(within(region).getByText('Not provided')).toBeTruthy();
    expect(region.textContent).not.toContain('Source:');
  });

  it('gives long received and final values distinct disclosure names', () => {
    render(
      <IncidentAlertContextCard
        fields={[field('payload', 'Payload')]}
        sensitive
        omitted
        receivedContext={{ payload: { state: 'RECOGNIZED', value: 'a'.repeat(400) } }}
        context={{ payload: { state: 'RECOGNIZED', value: 'b'.repeat(400) } }}
      />
    );
    expect(screen.getByText('Show full value').getAttribute('aria-label')).toBe(
      'Show full Payload'
    );
    expect(screen.getByText('Show full received value').getAttribute('aria-label')).toBe(
      'Show full received Payload'
    );
    expect(
      screen.getByText('Some diagnostic values were omitted from the stored explanation.')
    ).toBeTruthy();
  });

  it('hides every value and field from restricted readers', () => {
    const { container } = render(
      <IncidentAlertContextCard
        fields={fields}
        sensitive={false}
        omitted
        receivedContext={{ environment: { state: 'RECOGNIZED', value: 'private-staging' } }}
        context={{ environment: { state: 'RECOGNIZED', value: 'private-production' } }}
      />
    );
    expect(screen.getByText('Alert context is restricted.')).toBeTruthy();
    expect(container.textContent).not.toContain('private-');
    expect(container.textContent).not.toContain('Environment');
    expect(container.textContent).not.toContain('omitted');
  });
});
