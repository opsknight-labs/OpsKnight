import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  currentUser: vi.fn(),
  view: vi.fn(),
  bindings: vi.fn(),
  executions: vi.fn(),
  suggestions: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: mocks.permissions,
  getCurrentUser: mocks.currentUser,
  assertCanViewIncident: mocks.view,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    serviceAutomationRule: { findMany: mocks.bindings },
    incident: { findUnique: vi.fn().mockResolvedValue({ status: 'OPEN' }) },
    runbookExecution: { findMany: mocks.executions, count: vi.fn().mockResolvedValue(0) },
    runbookSuggestion: { findMany: mocks.suggestions },
    runbookExecutionStep: { count: vi.fn().mockResolvedValue(0) },
    systemSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('@/components/incident/runbook-actions', () => ({
  approveIncidentRunbookStepAction: vi.fn(),
  cancelIncidentRunbookAction: vi.fn(),
  dismissIncidentRunbookSuggestionAction: vi.fn(),
  executePreviewedIncidentRunbookAction: vi.fn(),
  previewIncidentRunbookAction: vi.fn(),
}));
vi.mock('@/components/runbooks/RunbookExecutionPreview', () => ({ default: () => null }));

import IncidentRunbooks from '@/components/incident/IncidentRunbooks';

const definition = {
  steps: [
    {
      key: 'check',
      name: 'Check',
      type: 'WAIT',
      riskClass: 'READ_ONLY',
      config: { durationSeconds: 0 },
    },
  ],
};

function step(id: string, riskClass: string, verificationResult: unknown, status = 'SUCCEEDED') {
  return {
    id,
    stepKey: id,
    sequence: 0,
    name: `Step ${id}`,
    type: 'WAIT',
    riskClass,
    status,
    config: { durationSeconds: 0 },
    verificationResult,
    outputPreview: null,
    outputArtifactId: null,
    timeoutSeconds: 60,
    attempts: [],
  };
}

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'x1',
    status: 'SUCCEEDED',
    failureCode: null,
    createdAt: new Date('2026-10-19T10:00:00Z'),
    inputValues: {},
    definitionChecksum: 'a'.repeat(64),
    resolvedTargetAgentId: 'agent-1',
    resolvedTargetAgentPoolId: null,
    targetSelection: {
      selector: { host: '${{ context.host }}', role: 'web' },
      resolvedLabels: { host: 'web-01.prod', role: 'web' },
      contextKeys: ['host'],
      poolId: 'pool-1',
    },
    unattendedWritesAuthorized: true,
    recoveryOutcome: 'RESOLVED',
    recoveryCheckedAt: new Date('2026-10-19T10:20:00Z'),
    runbook: { name: 'Restart web' },
    runbookVersion: { version: 3, definition },
    binding: null,
    resolvedTargetAgent: { name: 'agent-eu-1', hostname: 'web-01.prod' },
    resolvedTargetAgentPool: null,
    steps: [
      step('read', 'READ_ONLY', null),
      step('restart', 'IDEMPOTENT_WRITE', {
        verified: true,
        checkKeys: ['check'],
        capturedAt: '2026-10-19T10:10:00.000Z',
        reason: 'ok',
        differences: [],
      }),
    ],
    ...overrides,
  };
}

describe('IncidentRunbooks response summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ id: 'user-1', timeZone: 'UTC' });
    mocks.bindings.mockResolvedValue([]);
    mocks.suggestions.mockResolvedValue([]);
    mocks.view.mockResolvedValue({});
  });

  it('shows target, context labels, unattended writes, verification and recovery', async () => {
    mocks.permissions.mockResolvedValue({
      capabilities: ['runbook.read.all', 'incident.sensitive.read'],
    });
    mocks.executions.mockResolvedValue([execution()]);
    const html = renderToStaticMarkup(
      (await IncidentRunbooks({ incidentId: 'inc-1', serviceId: 'svc-1' }))!
    );
    expect(html).toContain('Restart web response summary');
    expect(html).toContain('agent-eu-1 (web-01.prod)');
    expect(html).toContain('host=web-01.prod · context');
    expect(html).toContain('role=web');
    expect(html).toContain('Unattended writes authorized');
    expect(html).toContain('All write actions verified');
    expect(html).toContain('Resolved after verified recovery');
  });

  it('shows approval-required writes, unverified actions and redacted context labels', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['runbook.read.all'] });
    mocks.executions.mockResolvedValue([
      execution({
        unattendedWritesAuthorized: false,
        recoveryOutcome: 'NOT_VERIFIED',
        resolvedTargetAgent: null,
        resolvedTargetAgentId: null,
        steps: [
          step('restart', 'IDEMPOTENT_WRITE', {
            verified: false,
            checkKeys: ['check'],
            capturedAt: '2026-10-19T10:10:00.000Z',
            reason: 'still failing',
            differences: [],
          }),
        ],
      }),
    ]);
    const html = renderToStaticMarkup(
      (await IncidentRunbooks({ incidentId: 'inc-1', serviceId: 'svc-1' }))!
    );
    expect(html).toContain('Approval required');
    expect(html).toContain('Write actions unverified');
    expect(html).toContain('Recovery not verified');
    expect(html).toContain('host=[restricted]');
    expect(html).not.toContain('web-01.prod');
  });

  it('omits write and verification rows for read-only executions not yet evaluated', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['runbook.read.all'] });
    mocks.executions.mockResolvedValue([
      execution({
        recoveryOutcome: null,
        recoveryCheckedAt: null,
        targetSelection: {},
        resolvedTargetAgent: null,
        resolvedTargetAgentId: null,
        steps: [step('read', 'READ_ONLY', null)],
      }),
    ]);
    const html = renderToStaticMarkup(
      (await IncidentRunbooks({ incidentId: 'inc-1', serviceId: 'svc-1' }))!
    );
    expect(html).toContain('OpsKnight control plane');
    expect(html).not.toContain('Unattended writes authorized');
    expect(html).not.toContain('Approval required');
    expect(html).toContain('Not evaluated yet');
  });

  it('recommends resolution when recovery is verified but auto-resolve is off', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['runbook.read.all'] });
    mocks.executions.mockResolvedValue([execution({ recoveryOutcome: 'NOT_REQUESTED' })]);
    const html = renderToStaticMarkup(
      (await IncidentRunbooks({ incidentId: 'inc-1', serviceId: 'svc-1' }))!
    );
    expect(html).toContain('Resolution recommended');
    expect(html).not.toContain('Resolution not requested');
    expect(html).toContain('id="runbook-execution-x1"');
    expect(html).toContain('href="/runbooks/executions/x1"');
  });

  it('explains that paging continues while an execution waits for approval', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['runbook.read.all'] });
    mocks.executions.mockResolvedValue([
      execution({
        status: 'WAITING_APPROVAL',
        recoveryOutcome: null,
        recoveryCheckedAt: null,
        steps: [step('restart', 'IDEMPOTENT_WRITE', null, 'WAITING_APPROVAL')],
      }),
    ]);
    const html = renderToStaticMarkup(
      (await IncidentRunbooks({ incidentId: 'inc-1', serviceId: 'svc-1' }))!
    );
    expect(html).toContain('Waiting for approval. Paging continues meanwhile.');
    expect(html).toContain('Verification pending');
  });
});
