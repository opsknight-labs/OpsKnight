import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { inAppNotificationHref } from '@/lib/notification-links';
import {
  MCP_APPROVAL_ABSOLUTE_MAX_MS,
  commitDeadline,
  readMcpApprovalTiming,
  reviewDeadline,
} from '@/lib/mcp/approvals/timing';
import { parseMcpListParams } from '@/app/(app)/settings/integrations/mcp/list-params';
import {
  expectedReviewCode,
  reviewMessage,
} from '@/app/(app)/settings/integrations/mcp/approvals/review-result';
import { reviewBlockedReason } from '@/app/(app)/settings/integrations/mcp/approvals/review-gate';

const decide = vi.hoisted(() => ({ operation: vi.fn(), runbook: vi.fn() }));
vi.mock('@/lib/mcp/approvals/operation', () => ({ decideMcpOperationReview: decide.operation }));
vi.mock('@/lib/mcp/approvals/runbook', () => ({ decideMcpRunbookReview: decide.runbook }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(async () => ({
    authenticated: true,
    capabilities: ['runbook.approve'],
  })),
  getCurrentUser: vi.fn(async () => ({ id: 'u1', tokenVersion: 3 })),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const operationForm = (decision: string, reason?: string) => {
  const form = new FormData();
  form.set('id', 'cabc1234567890123456789012');
  form.set('operationDigest', 'a'.repeat(64));
  form.set('decision', decision);
  if (reason !== undefined) form.set('reason', reason);
  return form;
};

describe('approval timing', () => {
  it('reads the policy windows and clamps a bad row', async () => {
    const store = (row: object | null) => ({
      mcpPolicy: { findUnique: vi.fn(async () => row) },
    });
    expect(await readMcpApprovalTiming(store(null) as never)).toEqual({
      ttlMinutes: 240,
      commitWindowMinutes: 30,
    });
    expect(
      await readMcpApprovalTiming(
        store({ approvalTtlMinutes: 5, approvalCommitWindowMinutes: 99999 }) as never
      )
    ).toEqual({ ttlMinutes: 15, commitWindowMinutes: 1440 });
  });

  it('opens a fresh commit window on approval, never past 24 hours from the request', () => {
    const timing = { ttlMinutes: 240, commitWindowMinutes: 30 };
    const now = Date.parse('2026-11-04T12:00:00Z');
    expect(reviewDeadline(timing, now).getTime()).toBe(now + 240 * 60_000);
    const createdAt = new Date(now - 14 * 60_000 - 40_000);
    expect(commitDeadline(timing, createdAt, now).getTime()).toBe(now + 30 * 60_000);
    const old = new Date(now - MCP_APPROVAL_ABSOLUTE_MAX_MS + 60_000);
    expect(commitDeadline(timing, old, now).getTime()).toBe(
      old.getTime() + MCP_APPROVAL_ABSOLUTE_MAX_MS
    );
  });
});

describe('approval notification links', () => {
  it('opens the matching review page for an MCP approval and nothing else', () => {
    expect(
      inAppNotificationHref({ entityType: 'MCP_APPROVAL', entityId: 'cabc1234567890123456789012' })
    ).toBe('/settings/integrations/mcp/approvals/operations/cabc1234567890123456789012');
    const hex = 'f'.repeat(64);
    expect(inAppNotificationHref({ entityType: 'MCP_APPROVAL', entityId: hex })).toBe(
      `/settings/integrations/mcp/approvals/${hex}`
    );
    expect(
      inAppNotificationHref({ entityType: 'MCP_APPROVAL', entityId: '../../admin' })
    ).toBeNull();
    expect(inAppNotificationHref({ entityType: 'INCIDENT', entityId: 'i1' })).toBeNull();
    expect(inAppNotificationHref({ entityType: 'MCP_APPROVAL', entityId: null })).toBeNull();
    // SSO link requests (from main) still open the SSO access screen.
    expect(inAppNotificationHref({ entityType: 'SSO_LINK_REQUEST', entityId: 'u1' })).toBe(
      '/settings/system?section=sso&authTab=access&linking=requested'
    );
  });
});

describe('review outcomes', () => {
  beforeEach(() => {
    decide.operation.mockReset();
    decide.runbook.mockReset();
  });

  it('maps expected refusals to codes with guidance and leaves the rest as errors', () => {
    expect(expectedReviewCode(new McpBoundaryError('MCP_APPROVAL_EXPIRED', 409))).toBe(
      'MCP_APPROVAL_EXPIRED'
    );
    // Runbook review errors carry their code as the message.
    expect(expectedReviewCode(new Error('PREVIEW_ALREADY_REVIEWED'))).toBe(
      'PREVIEW_ALREADY_REVIEWED'
    );
    expect(expectedReviewCode(new Error('database exploded'))).toBeNull();
    expect(reviewMessage('MCP_REAUTHENTICATION_REQUIRED')).toContain("Confirm it's you");
    // A disabled requester or a revoked connection is an expected refusal, not an error page.
    expect(reviewMessage('MCP_INACTIVE_PRINCIPAL')).toContain('no longer active');
    expect(reviewMessage('MCP_INVALID_GRANT')).toContain('was revoked');
    expect(reviewMessage('SOMETHING_NEW')).toContain('could not be recorded');
    // Inherited object keys are not expected refusals: they must still surface as real errors.
    expect(expectedReviewCode(new Error('constructor'))).toBeNull();
    expect(expectedReviewCode(Object.assign(new Error('x'), { code: 'toString' }))).toBeNull();
    expect(reviewMessage('constructor')).toContain('could not be recorded');
  });

  it('completes the loader reasons a reviewer can be blocked for', () => {
    // A malformed id fails the id format check before any lookup; it is a missing request.
    expect(reviewBlockedReason(Object.assign(new Error('invalid id'), { name: 'ZodError' }))).toBe(
      'unavailable'
    );
    expect(reviewBlockedReason(new McpBoundaryError('MCP_APPROVAL_UNAVAILABLE', 404))).toBe(
      'unavailable'
    );
    expect(reviewBlockedReason(new McpBoundaryError('MCP_REVIEWER_CHANGED', 403))).toBe(
      'reviewer-changed'
    );
    expect(reviewBlockedReason(new Error('PREVIEW_REVIEW_RESOURCE_UNAVAILABLE'))).toBe(
      'target-hidden'
    );
    expect(reviewBlockedReason(new Error('PREVIEW_REVIEW_APPROVER_CHANGED'))).toBe(
      'reviewer-changed'
    );
  });

  it('returns a typed result from the review actions and passes the reason through', async () => {
    const { reviewPreparedOperation, reviewPreparedRunbook } =
      await import('@/app/(app)/settings/integrations/mcp/approvals/actions');
    decide.operation.mockResolvedValueOnce(undefined);
    await expect(
      reviewPreparedOperation(null, operationForm('reject', '  wrong service  '))
    ).resolves.toEqual({ ok: true, decision: 'reject' });
    expect(decide.operation).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'reject', reason: 'wrong service' }),
      expect.objectContaining({ id: 'u1', tokenVersion: 3 })
    );

    decide.operation.mockRejectedValueOnce(new McpBoundaryError('MCP_REAUTHENTICATION_REQUIRED'));
    await expect(reviewPreparedOperation(null, operationForm('approve'))).resolves.toEqual({
      ok: false,
      code: 'MCP_REAUTHENTICATION_REQUIRED',
    });

    decide.operation.mockRejectedValueOnce(new Error('connection reset'));
    await expect(reviewPreparedOperation(null, operationForm('approve'))).rejects.toThrow(
      'connection reset'
    );

    const runbookForm = new FormData();
    runbookForm.set('id', 'b'.repeat(64));
    runbookForm.set('planDigest', 'c'.repeat(64));
    runbookForm.set('decision', 'approve');
    decide.runbook.mockRejectedValueOnce(new Error('PREVIEW_ALREADY_REVIEWED'));
    await expect(reviewPreparedRunbook(null, runbookForm)).resolves.toEqual({
      ok: false,
      code: 'PREVIEW_ALREADY_REVIEWED',
    });
  });
});

describe('approvals section access', () => {
  it('opens the runbook queue to runbook approvers and keeps everyone else out', () => {
    expect(
      parseMcpListParams({ tab: 'approvals', kind: 'operations' }, false, 'runbooks')
    ).toMatchObject({
      section: 'approvals',
      approvalKind: 'runbooks',
    });
    expect(parseMcpListParams({ tab: 'approvals' }, false, 'none').section).toBe('overview');
    expect(parseMcpListParams({ tab: 'approvals' }, false).section).toBe('overview');
    expect(parseMcpListParams({ tab: 'policy' }, false, 'runbooks').section).toBe('overview');
    expect(parseMcpListParams({ tab: 'approvals', kind: 'operations' }, true)).toMatchObject({
      section: 'approvals',
      approvalKind: 'operations',
    });
  });
});
