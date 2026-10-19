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
  authorizeUnattendedWritesAction: vi.fn(),
  revokeUnattendedWritesAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
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

it('shows read-only verified-recovery and unattended-write status to viewers', () => {
  const binding = {
    ...fixture(),
    mode: 'AUTOMATIC',
    versionStrategy: 'PINNED',
    runbookVersionId: 'version-3',
    runbookVersion: { version: 3, inputs: [] },
    resolveOnVerifiedRecovery: true,
    unattendedWritesVersionId: 'version-3',
    unattendedWritesAuthorizedAt: new Date('2026-10-19T10:00:00Z'),
    unattendedWritesAuthorizedBy: { name: 'Alice Admin' },
  } as unknown as ComponentProps<typeof ServiceRunbooks>['bindings'][number];
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
  expect(screen.getByText('Resolves on verified recovery')).toBeVisible();
  expect(screen.getByText('Unattended writes · v3')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Authorize/ })).not.toBeInTheDocument();
});

it('summarizes monitoring opt-in, automation conditions and context mappings', () => {
  const binding = {
    ...fixture(),
    runOnMonitoringIncidents: true,
    contextInputMappings: [{ inputKey: 'credential', contextKey: 'cluster' }],
    contextTargetMappings: {
      contextKey: 'cluster',
      entries: [{ value: 'prod-k8s-01', agentPoolId: 'cjld2cjxh0000qzrmn831i7rn' }],
    },
    triggers: [
      {
        id: 'trigger',
        event: 'INCIDENT_CREATED',
        enabled: true,
        conditions: [{ field: 'automation.cluster', operator: 'EXISTS', value: null }],
      },
    ],
  } as unknown as ComponentProps<typeof ServiceRunbooks>['bindings'][number];
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
  expect(screen.getByText('Runs on monitoring incidents')).toBeVisible();
  expect(screen.getByText(/Target: Unavailable Agent/)).toHaveTextContent(
    /uses automation context · target by automation.cluster \(1 approved\) · 1 input from context/
  );
});

it('shows the unattended-write panel with eligibility only to administrators', () => {
  const binding = {
    ...fixture(),
    mode: 'AUTOMATIC',
    versionStrategy: 'PINNED',
    runbookVersionId: 'version-3',
    runbookVersion: { version: 3, inputs: [] },
  } as unknown as ComponentProps<typeof ServiceRunbooks>['bindings'][number];
  render(
    <ServiceRunbooks
      serviceId="service"
      bindings={[binding]}
      availableRunbooks={[]}
      availableAgents={[]}
      availableAgentPools={[]}
      canManage={true}
      canAuthorizeUnattendedWrites={true}
      unattendedWriteDetails={{
        binding: {
          authorizedAtLabel: null,
          eligibility: {
            eligible: true,
            reasons: [],
            writeActions: [
              {
                key: 'restart',
                name: 'Restart pod',
                type: 'KUBERNETES',
                riskClass: 'IDEMPOTENT_WRITE',
                hasVerification: true,
              },
            ],
          },
        },
      }}
    />
  );
  expect(screen.getByRole('region', { name: 'Unattended write steps' })).toBeVisible();
  expect(screen.getByText('Restart pod')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Authorize v3' })).toBeVisible();
});
