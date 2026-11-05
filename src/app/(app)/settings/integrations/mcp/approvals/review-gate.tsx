import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { formatDateTime } from '@/lib/timezone';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { Deadline } from '@/components/settings/mcp/McpListKit';
import { mcpHref } from '../list-params';

/** Shared definition-list styles for the review and status pages, readable in both themes. */
export const DT_CLASS = 'text-xs uppercase tracking-wide text-muted-foreground';
export const DD_CLASS = 'text-foreground';

/** Back to the approvals queue, on every review and status page. */
export function BackToApprovals() {
  return (
    <Link
      href={mcpHref({ tab: 'approvals' })}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to approvals
    </Link>
  );
}

/** One plain sentence for both review pages, plus the untrusted-data note. */
export function ReviewIntro() {
  return (
    <div className="space-y-1">
      <p>
        Approving lets this run once, exactly as shown. Permissions are re-checked when it runs.
      </p>
      <p className="text-sm text-muted-foreground">
        Names and text below come from the assistant&apos;s request and may be inaccurate.
      </p>
    </div>
  );
}

type Blocked =
  | 'own-request'
  | 'not-authorized'
  | 'expired'
  | 'unavailable'
  | 'reviewer-changed'
  | 'target-hidden'
  | 'requester-changed';

const REASONS = new Map<string, Blocked>([
  ['MCP_DISTINCT_REVIEWER_REQUIRED', 'own-request'],
  ['PREVIEW_REVIEW_DISTINCT_ACTOR_REQUIRED', 'own-request'],
  ['MCP_REVIEWER_NOT_AUTHORIZED', 'not-authorized'],
  ['MCP_APPROVER_REQUIRED', 'not-authorized'],
  ['MCP_APPROVAL_EXPIRED', 'expired'],
  ['PREVIEW_REVIEW_EXPIRED', 'expired'],
  ['PREVIEW_ALREADY_REVIEWED', 'expired'],
  ['MCP_APPROVAL_UNAVAILABLE', 'unavailable'],
  ['MCP_REVIEWER_CHANGED', 'reviewer-changed'],
  ['PREVIEW_REVIEW_APPROVER_CHANGED', 'reviewer-changed'],
  ['PREVIEW_REVIEW_RESOURCE_UNAVAILABLE', 'target-hidden'],
  ['MCP_RESOURCE_UNAVAILABLE', 'requester-changed'],
  ['MCP_OPERATION_FORBIDDEN', 'requester-changed'],
  ['MCP_AUTHORITY_CHANGED', 'requester-changed'],
  ['MCP_ACCESS_CHANGED', 'requester-changed'],
  ['MCP_INVALID_TOKEN', 'requester-changed'],
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
    unavailable: {
      title: 'This request was not found',
      body: 'The link may be wrong, or the request was removed after it was closed.',
    },
    'reviewer-changed': {
      title: 'Your access changed',
      body: 'Your account, role or teams changed since you signed in. Sign out, sign in again and reopen this link.',
    },
    'target-hidden': {
      title: 'You cannot review this plan',
      body: 'It targets an incident or service you cannot see. Send this page link to someone who can.',
    },
    'requester-changed': {
      title: 'This request can no longer be approved',
      body: "The requester's access or assistant connection changed after they asked. Ask them to prepare it again.",
    },
  }) as [Blocked, { title: string; body: string }][]
);

export function ReviewUnavailable({ reason, heading }: { reason: Blocked; heading: string }) {
  const copy = COPY.get(reason)!;
  return (
    <div className="max-w-3xl space-y-4 rounded-lg border p-6">
      <BackToApprovals />
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <InlineNotice tone="warning" role="status" title={copy.title}>
        <p className="text-sm">{copy.body}</p>
      </InlineNotice>
    </div>
  );
}

/**
 * Shown when an administrator reviews their own request. The checkbox is required for Approve;
 * the server enforces the same confirmation, so this is never only a browser check.
 */
export function SelfApprovalConfirm() {
  return (
    <InlineNotice tone="warning" role="note" aria-live="off" title="You requested this change">
      <p className="text-sm">
        As an administrator you can approve it yourself. It will run once, exactly as shown above,
        and the audit log records it as self-approved.
      </p>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirmSelfApproval" value="yes" required className="mt-1" />
        <span>I have reviewed this change and I am sure I want to apply it.</span>
      </label>
    </InlineNotice>
  );
}

type Person = { name: string | null; email: string | null };

function personText(person: Person) {
  return person.name ?? person.email ?? 'Unknown user';
}

/** "Requested by X via assistant at T". Assistant names can be self-chosen, so they are quoted. */
export function RequestedBy({
  person,
  assistant,
  at,
  timeZone = 'UTC',
}: {
  person: Person;
  assistant: { name: string } | null;
  at: Date;
  /** The viewer's time zone; the absolute time is shown in it. */
  timeZone?: string;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      Requested by <span className="font-medium text-foreground">{personText(person)}</span>
      {person.name && person.email ? ` (${person.email})` : ''}
      {assistant ? (
        <>
          {' '}
          via the assistant <span className="font-medium text-foreground">“{assistant.name}”</span>
        </>
      ) : null}{' '}
      at{' '}
      <time dateTime={at.toISOString()}>
        {formatDateTime(at, timeZone, { includeTimeZone: true })}
      </time>
    </p>
  );
}

const STATUS_COPY = new Map<string, { label: string; body: string }>(
  Object.entries({
    PENDING: {
      label: 'Waiting for review',
      body: 'Reviewers were notified in OpsKnight. You can also send them this page link.',
    },
    APPROVED: {
      label: 'Approved',
      body: 'Ask your assistant to continue; it can apply the approved request once before the deadline below.',
    },
    REJECTED: {
      label: 'Rejected',
      body: 'Nothing was changed. Ask your assistant to prepare a corrected request if needed.',
    },
    EXPIRED: {
      label: 'Expired',
      body: 'It was not used in time. Ask your assistant to prepare it again.',
    },
    EXECUTING: { label: 'Running', body: 'Your assistant is applying the approved request.' },
    COMMITTED: { label: 'Completed', body: 'The approved request was applied.' },
    CONSUMED: { label: 'Completed', body: 'The approved plan was started.' },
    FAILED: { label: 'Failed', body: 'The approved request could not be applied.' },
  })
);

/** Plain status labels shared by the review pages and the requester's status view. */
export function statusLabel(status: string) {
  return STATUS_COPY.get(status)?.label ?? status;
}

/** What a requester sees on their own request: status only, never the review controls. */
export function RequesterStatus({
  heading,
  status,
  expiresAt,
  reviewer,
  decidedAt,
  selfApproved,
  decisionReason,
  timeZone = 'UTC',
  now = new Date(),
  children,
}: {
  heading: string;
  status: string;
  expiresAt: Date;
  reviewer: Person | null;
  decidedAt: Date | null;
  selfApproved: boolean;
  decisionReason: string | null;
  timeZone?: string;
  now?: Date;
  children?: ReactNode;
}) {
  const copy = STATUS_COPY.get(status) ?? { label: status, body: '' };
  const open = status === 'PENDING' || status === 'APPROVED';
  return (
    <div className="max-w-3xl space-y-4 rounded-lg border p-6">
      <BackToApprovals />
      <h1 className="text-2xl font-semibold">{heading}</h1>
      {children}
      <div role="status" className="rounded border p-4">
        <p className="font-medium">Status: {copy.label}</p>
        <p className="mt-1 text-sm">{copy.body}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 break-words">
        {open && (
          <>
            <dt className={DT_CLASS}>{status === 'APPROVED' ? 'Apply before' : 'Review before'}</dt>
            <dd className={DD_CLASS}>
              <Deadline value={expiresAt} now={now} timeZone={timeZone} />
            </dd>
          </>
        )}
        {decidedAt && (
          <>
            <dt className={DT_CLASS}>Decided</dt>
            <dd className={DD_CLASS}>
              <time dateTime={decidedAt.toISOString()}>
                {formatDateTime(decidedAt, timeZone, { includeTimeZone: true })}
              </time>
              {reviewer ? ` by ${personText(reviewer)}` : ''}
              {selfApproved ? ' (self-approved)' : ''}
            </dd>
          </>
        )}
      </dl>
      <DecisionReason reason={decisionReason} />
    </div>
  );
}

/** The reviewer's note: written by a person, shown verbatim as untrusted text. */
export function DecisionReason({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <div className="rounded border p-4">
      <p className="text-sm font-medium">Reviewer&apos;s note</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{reason}</p>
    </div>
  );
}
