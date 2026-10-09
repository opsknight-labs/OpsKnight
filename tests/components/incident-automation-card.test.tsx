import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ visible: vi.fn(), permissions: vi.fn(), decision: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertCanViewIncident: mocks.visible,
  getUserPermissions: mocks.permissions,
}));
vi.mock('@/lib/prisma', () => ({
  default: { incidentAutomationDecision: { findUnique: mocks.decision } },
}));
import IncidentAutomationCard from '@/components/automation/IncidentAutomationCard';
beforeEach(() => {
  vi.clearAllMocks();
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
