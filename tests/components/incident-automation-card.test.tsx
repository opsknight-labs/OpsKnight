import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
beforeEach(() => {
  vi.clearAllMocks();
  mocks.notifications.mockResolvedValue([]);
  mocks.visible.mockResolvedValue({ id: 'reader' });
  mocks.decision.mockResolvedValue({
    routeType: 'ESCALATION_POLICY',
    matchedRouteRuleName: 'Internal routing',
    escalationPolicyNameSnapshot: 'Production primary',
    summary: {
      normalization: [
        {
          fieldKey: 'customer_email',
          raw: 'private@example.com',
          canonical: { state: 'RECOGNIZED', value: 'private@example.com' },
        },
      ],
      inputContext: { account: { state: 'RECOGNIZED', value: 'private-account' } },
      writes: [{ fieldKey: 'tenant', value: 'private-tenant' }],
    },
    version: { versionNumber: 1 },
  });
});
it.each(['ADMIN', 'RESPONDER', 'AUDITOR'])(
  'shows full explanations to a permitted sensitive %s reader',
  async role => {
    mocks.permissions.mockResolvedValue({
      role,
      capabilities: ['automation.read', 'incident.sensitive.read'],
    });
    const html = renderToStaticMarkup((await IncidentAutomationCard({ incidentId: 'incident' }))!);
    expect(html).toContain('Internal routing');
    expect(html).toContain('private@example.com');
    expect(html).toContain('private-account');
  }
);
it.each(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'])(
  'redacts values when %s lacks sensitive permission',
  async role => {
    mocks.permissions.mockResolvedValue({ role, capabilities: ['automation.read'] });
    const html = renderToStaticMarkup((await IncidentAutomationCard({ incidentId: 'incident' }))!);
    expect(html).toContain('Internal routing');
    expect(html).not.toContain('private@example.com');
    expect(html).not.toContain('private-account');
    expect(html).not.toContain('private-tenant');
  }
);
it.each(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'])(
  'does not query explanations when %s lacks automation.read',
  async role => {
    mocks.permissions.mockResolvedValue({ role, capabilities: ['incident.sensitive.read'] });
    expect(await IncidentAutomationCard({ incidentId: 'incident' })).toBeNull();
    expect(mocks.decision).not.toHaveBeenCalled();
  }
);
it('denies an invisible incident before reading permissions or decisions', async () => {
  mocks.visible.mockRejectedValue(new Error('Incident access denied'));
  await expect(IncidentAutomationCard({ incidentId: 'incident' })).rejects.toThrow(
    'Incident access denied'
  );
  expect(mocks.permissions).not.toHaveBeenCalled();
  expect(mocks.decision).not.toHaveBeenCalled();
});

it('shows pinned human-readable labels and enriched values outside the evaluation disclosure', async () => {
  mocks.permissions.mockResolvedValue({
    capabilities: ['automation.read', 'incident.sensitive.read'],
  });
  mocks.decision.mockResolvedValue({
    routeType: 'SERVICE_DEFAULT',
    matchedRouteRuleId: 'production-route',
    summary: {
      inputContext: { environment: { state: 'RECOGNIZED', value: 'staging' } },
      enrichedContext: { environment: { state: 'RECOGNIZED', value: 'production' } },
    },
    version: {
      versionNumber: 2,
      snapshot: {
        schemaVersion: 1,
        fields: [
          {
            fieldId: 'environment-field',
            key: 'environment',
            label: 'Deployment environment',
            type: 'STRING',
            mappings: [],
          },
        ],
        rules: [
          {
            id: 'production-route',
            name: 'Production route',
            phase: 'ROUTE',
            enabled: true,
            conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
            actions: [{ type: 'USE_SERVICE_DEFAULT' }],
          },
        ],
      },
    },
  });
  const html = renderToStaticMarkup((await IncidentAutomationCard({ incidentId: 'incident' }))!);
  expect(html).toContain('Alert Context');
  expect(html.indexOf('Deployment environment')).toBeLessThan(html.indexOf('View evaluation'));
  expect(html).toContain('production');
  expect(html).toContain('Deployment environment equals production');
});

it('keeps selected actions separate from actual queued, accepted and delivered records', async () => {
  mocks.permissions.mockResolvedValue({
    capabilities: ['automation.read', 'incident.sensitive.read'],
  });
  const decision = await mocks.decision();
  mocks.decision.mockResolvedValue({
    ...decision,
    summary: { supplementalActions: [{ provider: 'SLACK' }] },
  });
  mocks.notifications.mockResolvedValue([
    { channel: 'SLACK', status: 'PENDING', _count: { _all: 2 } },
    { channel: 'SLACK', status: 'SENT', _count: { _all: 1 } },
    { channel: 'MICROSOFT_TEAMS', status: 'DELIVERED', _count: { _all: 1 } },
  ]);
  const html = renderToStaticMarkup((await IncidentAutomationCard({ incidentId: 'incident' }))!);
  expect(html).toContain('Selected channel actions: Slack');
  expect(html).toContain('Queued');
  expect(html).toContain('Accepted by provider');
  expect(html).toContain('Delivery confirmed');
  expect(html).not.toContain('Notified Slack');
  expect(mocks.notifications).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ incidentId: 'incident' }),
    })
  );
});

it('does not infer delivery from a selected action with no notification record', async () => {
  mocks.permissions.mockResolvedValue({
    capabilities: ['automation.read', 'incident.sensitive.read'],
  });
  const decision = await mocks.decision();
  mocks.decision.mockResolvedValue({
    ...decision,
    routeType: 'NO_ESCALATION',
    summary: { supplementalActions: [{ provider: 'TEAMS' }] },
  });
  const html = renderToStaticMarkup((await IncidentAutomationCard({ incidentId: 'incident' }))!);
  expect(html).toContain('Personal paging intentionally skipped');
  expect(html).toContain('Selected channel actions: Teams');
  expect(html).toContain('No channel notification records are available');
  expect(html).not.toContain('Delivery confirmed');
});
