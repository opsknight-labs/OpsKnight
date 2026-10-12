// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ServiceRunbooks from '@/components/service/ServiceRunbooks';

vi.mock('@/app/(app)/services/[id]/runbook-actions', () => ({
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
