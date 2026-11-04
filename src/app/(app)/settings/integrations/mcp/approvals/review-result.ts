/**
 * Typed outcome of a review decision, shared by the server actions and the review form. Expected
 * refusals come back as a code with guidance; anything unexpected still throws to the error page.
 */
export type ReviewResult =
  { ok: true; decision: 'approve' | 'reject' } | { ok: false; code: string };

/** What the reviewer sees for each expected refusal. */
export const REVIEW_MESSAGES: Readonly<Record<string, string>> = {
  MCP_RATE_LIMITED: 'Too many review decisions in the last minute. Wait a moment and try again.',
  MCP_APPROVAL_UNAVAILABLE: 'This request no longer exists or is not available to you.',
  MCP_APPROVAL_EXPIRED:
    'This request is no longer open: it expired or someone else already decided it. Reload the page to see its status.',
  PREVIEW_REVIEW_EXPIRED:
    'This plan is no longer open: it expired or was already used. Ask the assistant to prepare it again.',
  PREVIEW_ALREADY_REVIEWED:
    'Someone already decided this plan. Reload the page to see the outcome.',
  MCP_APPROVAL_PLAN_CHANGED:
    'The request changed after this page was loaded. Reload the page and review it again.',
  PREVIEW_REVIEW_PLAN_CHANGED:
    'The plan changed after this page was loaded. Reload the page and review it again.',
  MCP_SELF_APPROVAL_CONFIRMATION_REQUIRED:
    'You requested this change. Tick the confirmation box to approve it yourself.',
  PREVIEW_REVIEW_SELF_APPROVAL_CONFIRMATION_REQUIRED:
    'You requested this run. Tick the confirmation box to approve it yourself.',
  MCP_REAUTHENTICATION_REQUIRED:
    'Approving a destructive change needs a recent sign-in. Use "Confirm it\'s you", then approve again.',
  MCP_REVIEWER_CHANGED:
    'Your account or role changed since you signed in. Reload the page and try again.',
  PREVIEW_REVIEW_APPROVER_CHANGED:
    'Your account or role changed since you signed in. Reload the page and try again.',
  MCP_REVIEWER_NOT_AUTHORIZED:
    'Your role cannot approve this change. Send the link to an administrator.',
  MCP_APPROVER_REQUIRED: 'Your role cannot approve runbook runs. Send the link to someone who can.',
  MCP_DISTINCT_REVIEWER_REQUIRED: 'You made this request, so a different person must review it.',
  PREVIEW_REVIEW_DISTINCT_ACTOR_REQUIRED:
    'You made this request, so a different person must review it.',
  PREVIEW_REVIEW_RESOURCE_UNAVAILABLE:
    'You cannot see the incident or service this plan targets, so you cannot review it.',
  MCP_RESOURCE_UNAVAILABLE:
    'The requester can no longer see the incident or service this plan targets.',
  MCP_OPERATION_FORBIDDEN:
    'The requester no longer has the permissions this request needs, so it cannot be approved.',
  MCP_OPERATION_DISABLED:
    'Reviewed changes are turned off in MCP settings, so this request cannot be approved now.',
  MCP_CAPABILITY_DISABLED:
    'An administrator turned this capability off, so this request cannot be approved now.',
  MCP_AUTHORITY_CHANGED:
    "The requester's access changed after the request was made, so it cannot be approved.",
  MCP_ACCESS_CHANGED:
    "The requester's assistant connection was signed out, so this request cannot be approved.",
  MCP_INVALID_TOKEN:
    "The requester's assistant connection is no longer valid, so this request cannot be approved.",
};

export function reviewMessage(code: string) {
  return (
    REVIEW_MESSAGES[code] ?? 'This decision could not be recorded. Reload the page and try again.'
  );
}

/** The code of an expected refusal, or null for anything that should surface as a real error. */
export function expectedReviewCode(error: unknown): string | null {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (code in REVIEW_MESSAGES) return code;
  // Runbook review errors carry their code as the message.
  const message = error instanceof Error ? error.message : '';
  return message in REVIEW_MESSAGES ? message : null;
}
