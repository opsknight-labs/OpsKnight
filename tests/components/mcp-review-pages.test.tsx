import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadMcpOperationReview: vi.fn(),
  loadMcpRunbookReview: vi.fn(),
  runbookFind: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({
    authenticated: true,
    isAdmin: true,
    capabilities: ['runbook.approve'],
  })),
  getCurrentUser: vi.fn(async () => ({ id: 'reviewer', tokenVersion: 0 })),
}));
vi.mock('@/app/(app)/settings/integrations/mcp/queries', () => ({
  describeMcpRequester: vi.fn(async () => ({
    person: { id: 'u1', name: 'Rita', email: null },
    assistant: { name: 'Claude' },
  })),
  loadMcpViewer: vi.fn(async () => ({ id: 'reviewer', isAdmin: true, timeZone: 'Asia/Kolkata' })),
}));
vi.mock('@/app/(app)/settings/integrations/mcp/approvals/actions', () => ({
  reviewPreparedOperation: vi.fn(),
  reviewPreparedRunbook: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    runbook: { findUnique: mocks.runbookFind },
    incident: { findUnique: vi.fn(async () => null) },
    service: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('@/lib/mcp/approvals/operation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/approvals/operation')>(
    '@/lib/mcp/approvals/operation'
  );
  return {
    operationApprovalStatus: actual.operationApprovalStatus,
    operationReviewSummarySchema: actual.operationReviewSummarySchema,
    loadMcpOperationRequest: vi.fn(async () => null),
    loadMcpOperationReview: mocks.loadMcpOperationReview,
  };
});
vi.mock('@/lib/mcp/approvals/runbook', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp/approvals/runbook')>(
    '@/lib/mcp/approvals/runbook'
  );
  return {
    runbookApprovalStatus: actual.runbookApprovalStatus,
    loadMcpRunbookRequest: vi.fn(async () => null),
    loadMcpRunbookReview: mocks.loadMcpRunbookReview,
  };
});

import OperationApproval from '@/app/(app)/settings/integrations/mcp/approvals/operations/[id]/page';
import RunbookApproval from '@/app/(app)/settings/integrations/mcp/approvals/[id]/page';

const soon = () => new Date(Date.now() + 27 * 60_000);
const digest = 'd'.repeat(64);

beforeEach(() => {
  mocks.loadMcpOperationReview.mockResolvedValue({
    selfReview: false,
    requiresFreshAuthentication: false,
    approval: {
      id: 'cappr',
      status: 'PENDING',
      expiresAt: soon(),
      createdAt: new Date('2026-11-05T09:00:00Z'),
      actorId: 'u1',
      requesterGrantId: 'g1',
      operationDigest: digest,
      selfApproved: false,
      decisionReason: null,
    },
    summary: {
      operationId: 'updateTeam',
      method: 'PATCH',
      path: '/teams/{id}',
      risk: 'R2',
      description: 'Update a team',
      targets: { id: 't1' },
      ifMatch: '"3"',
      query: [],
      changes: [
        ['name', 'Platform'],
        ['description', 'After'],
      ],
      truncated: false,
      preview: null,
      diff: [
        { field: 'name', before: 'Platform', after: 'Platform', status: 'unchanged' },
        { field: 'description', before: 'Before', after: 'After', status: 'changed' },
        { field: 'members[1]', before: '.userId: u2', after: null, status: 'removed' },
      ],
    },
  });
  mocks.runbookFind.mockResolvedValue({ name: 'Restart the gateway' });
  mocks.loadMcpRunbookReview.mockResolvedValue({
    selfReview: false,
    preview: {
      id: 'p'.repeat(64),
      actorId: 'u1',
      requesterGrantId: 'g1',
      createdAt: new Date('2026-11-05T09:00:00Z'),
      expiresAt: soon(),
      reviewedAt: null,
      rejectedAt: null,
      consumedAt: null,
      selfApproved: false,
      decisionReason: null,
      planDigest: digest,
    },
    summary: {
      runbookId: 'crunbook0000000000000000',
      versionId: 'cversion0000000000000000',
      version: 3,
      checksum: 'c'.repeat(64),
      agentId: null,
      agentPoolId: null,
      incidentId: null,
      serviceId: null,
      inputs: [
        { key: 'unit', type: 'STRING', value: 'nginx' },
        { key: 'access_token', type: 'STRING', value: '[withheld: credential]' },
      ],
      steps: [
        { key: 'a', name: 'Look', type: 'HTTP', risk: 'READ_ONLY', configuration: [] },
        { key: 'b', name: 'Restart', type: 'SCRIPT', risk: 'NON_IDEMPOTENT', configuration: [] },
      ],
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UX-6 / UX-7 operation review page', () => {
  it('leads with what, where and risk, shows before/after and tucks verification away', async () => {
    render(await OperationApproval({ params: Promise.resolve({ id: 'cappr' }) }));
    expect(screen.getByRole('link', { name: 'Back to approvals' })).toBeTruthy();
    expect(screen.getByText('R2 · Sensitive change')).toBeTruthy();
    expect(screen.getByText(/in 27 minutes/)).toBeTruthy();
    expect(document.body.textContent).toContain('GMT+5:30');
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(screen.getByText('Waiting for review')).toBeTruthy();
    expect(
      screen.getByText(
        'Approving lets this run once, exactly as shown. Permissions are re-checked when it runs.'
      )
    ).toBeTruthy();
    // The changed field sits in the main table; the unchanged one is collapsed.
    const table = screen.getAllByRole('table', { name: /Changed fields/ })[0];
    const row = within(table)
      .getByRole('rowheader', { name: /description/ })
      .closest('tr')!;
    expect(row).toHaveTextContent('Before');
    expect(row).toHaveTextContent('After');
    expect(screen.getByText('1 unchanged field').closest('details')).not.toBeNull();
    // A list member the request drops is shown in the main table, never collapsed.
    const dropped = within(table)
      .getByRole('rowheader', { name: /members\[1\]/ })
      .closest('tr')!;
    expect(dropped).toHaveTextContent('Removed by this change');
    expect(dropped.closest('details')).toBeNull();
    // Digest and request line live behind "Verification details".
    const verification = screen.getByText('Verification details').closest('details')!;
    expect(verification).toHaveTextContent(digest);
    expect(verification).toHaveTextContent('PATCH /teams/{id}');
  });
});

describe('UX-7 runbook review page', () => {
  it('names the runbook, surfaces the highest step risk and hides the checksums', async () => {
    render(await RunbookApproval({ params: Promise.resolve({ id: 'p'.repeat(64) }) }));
    expect(screen.getByRole('link', { name: 'Restart the gateway' }).getAttribute('href')).toBe(
      '/runbooks/crunbook0000000000000000'
    );
    const risk = screen.getByText('Highest step risk').nextElementSibling!;
    expect(risk).toHaveTextContent('Change, not safe to repeat');
    const verification = screen.getByText('Verification details').closest('details')!;
    expect(verification).toHaveTextContent('c'.repeat(64));
    expect(verification).toHaveTextContent(digest);
    expect(screen.getByText('Waiting for review')).toBeTruthy();
    // The reviewer sees what the assistant supplied; a credential shows only that it exists.
    const inputs = screen.getByRole('heading', {
      name: 'Inputs the assistant supplied',
    }).parentElement!;
    expect(inputs).toHaveTextContent('unit');
    expect(inputs).toHaveTextContent('nginx');
    expect(inputs).toHaveTextContent('[withheld: credential]');
  });
});
