// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ServiceRunbooks from '@/components/service/ServiceRunbooks';

vi.mock('@/app/(app)/services/[id]/runbook-actions', () => ({
  checkRulePolicyAction: vi.fn(),
  pauseRuleAction: vi.fn(),
  duplicateRuleAction: vi.fn(),
  attachRunbookAction: vi.fn(),
  detachRunbookAction: vi.fn(),
  updateRunbookBindingAction: vi.fn(),
  configureRunbookTriggerAction: vi.fn(),
}));
afterEach(cleanup);
function fixture() {
  return {
    id: 'binding',
    runbookId: 'runbook',
    mode: 'MANUAL',
    enabled: true,
    versionStrategy: 'LATEST_PUBLISHED',
    runbookVersion: null,
    defaultAgentId: 'revoked-agent',
    defaultAgentPoolId: null,
    inputValues: {},
    runbook: {
      name: 'Recovery',
      description: '',
      publishedVersion: {
        inputs: [
          {
            key: 'credential',
            label: 'Credential',
            type: 'SECRET_REF',
            defaultValue: 'secret://sensitive-reference',
          },
        ],
      },
    },
    triggers: [{ id: 'disabled', event: 'INCIDENT_CREATED', enabled: false, conditions: [] }],
  } as unknown as ComponentProps<typeof ServiceRunbooks>['bindings'][number];
}
it('does not misrepresent an unavailable Agent or disabled trigger', () => {
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[fixture()]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={false}
    />
  );
  expect(screen.getByText(/Target: Unavailable Agent/)).toHaveTextContent('Trigger: Manual only');
  expect(screen.queryByText(/Control plane/)).not.toBeInTheDocument();
});
it('redacts secret-reference defaults in the service summary', () => {
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[fixture()]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={false}
    />
  );
  expect(screen.getByText('Configured secret reference')).toBeVisible();
  expect(screen.queryByText(/sensitive-reference/)).not.toBeInTheDocument();
});

it('displays unavailable error state when database query fails rather than empty state', () => {
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={false}
      loadError={true}
    />
  );
  expect(screen.getByText('Service runbooks unavailable')).toBeVisible();
  expect(screen.queryByText('No service runbooks')).not.toBeInTheDocument();
});

it('provides a View Runbook link rather than an inaccurate immediate execution trigger', () => {
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[fixture()]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={false}
    />
  );
  const link = screen.getByRole('link', { name: /View Runbook/i });
  expect(link).toBeVisible();
  expect(link).toHaveAttribute('href', '/runbooks/runbook');
});

it('does not arm an incident trigger in manual mode', () => {
  const binding = fixture();
  binding.triggers[0].enabled = true;
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[binding]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={false}
    />
  );
  expect(screen.getByText(/Inactive in Manual mode/)).toBeVisible();
});
it('describes a dynamic selector without calling it the control plane', () => {
  const binding = fixture();
  binding.defaultAgentId = null;
  binding.agentSelector = { environment: 'production' };
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[binding]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={false}
    />
  );
  expect(screen.getByText(/Dynamic selector/)).toHaveTextContent('environment=production');
  expect(screen.queryByText(/Control plane/)).not.toBeInTheDocument();
});
it('keeps loaded bindings visible when only Agent inventory fails', () => {
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[fixture()]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={true}
      loadErrors={['agents']}
    />
  );
  expect(screen.getByRole('link', { name: 'Recovery' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Agent inventory unavailable');
  expect(screen.queryByText(/Failed to load attached workflows/)).not.toBeInTheDocument();
});
