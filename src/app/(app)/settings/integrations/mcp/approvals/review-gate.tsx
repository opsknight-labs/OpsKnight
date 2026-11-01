import { McpBoundaryError } from '@/lib/mcp/core/errors';

type Blocked = 'own-request' | 'not-authorized' | 'expired';

const REASONS = new Map<string, Blocked>([
  ['MCP_DISTINCT_REVIEWER_REQUIRED', 'own-request'],
  ['PREVIEW_REVIEW_DISTINCT_ACTOR_REQUIRED', 'own-request'],
  ['MCP_REVIEWER_NOT_AUTHORIZED', 'not-authorized'],
  ['MCP_APPROVER_REQUIRED', 'not-authorized'],
  ['MCP_APPROVAL_EXPIRED', 'expired'],
  ['PREVIEW_REVIEW_EXPIRED', 'expired'],
]);

/** Expected reasons a person cannot review a request; anything else is a real failure. */
export function reviewBlockedReason(error: unknown): Blocked | null {
  const code =
    error instanceof McpBoundaryError ? error.code : error instanceof Error ? error.message : '';
  return REASONS.get(code) ?? null;
}

const COPY = new Map<Blocked, { title: string; body: string }>(
  Object.entries({
    'own-request': {
      title: 'Waiting for another reviewer',
      body: 'You made this request, so a different person must approve it. Send this page link to an OpsKnight administrator.',
    },
    'not-authorized': {
      title: 'An administrator must review this request',
      body: 'Your role cannot approve this change. Send this page link to an OpsKnight administrator.',
    },
    expired: {
      title: 'This request is no longer open',
      body: 'It expired or was already used. Ask the assistant to prepare the change again.',
    },
  }) as [Blocked, { title: string; body: string }][]
);

export function ReviewUnavailable({ reason, heading }: { reason: Blocked; heading: string }) {
  const copy = COPY.get(reason)!;
  return (
    <div className="max-w-3xl space-y-4 rounded-lg border p-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <div role="status" className="rounded border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <p className="font-medium">{copy.title}</p>
        <p className="mt-1 text-sm">{copy.body}</p>
      </div>
    </div>
  );
}

/**
 * Shown when an administrator reviews their own request. The checkbox is required for Approve;
 * the server enforces the same confirmation, so this is never only a browser check.
 */
export function SelfApprovalConfirm() {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <p className="font-medium">You requested this change</p>
      <p className="mt-1 text-sm">
        As an administrator you can approve it yourself. It will run once, exactly as shown above,
        and the audit log records it as self-approved.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirmSelfApproval" value="yes" required className="mt-1" />
        <span>I have reviewed this change and I am sure I want to apply it.</span>
      </label>
    </div>
  );
}
