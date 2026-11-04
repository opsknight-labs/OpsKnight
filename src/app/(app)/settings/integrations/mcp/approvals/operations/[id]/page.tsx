import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { requireMcp } from '@/lib/mcp/core/errors';
import { isAuthenticationFresh } from '@/lib/auth-control/actor';
import {
  loadMcpOperationRequest,
  loadMcpOperationReview,
  operationApprovalStatus,
  operationReviewSummarySchema,
} from '@/lib/mcp/approvals/operation';
import { describeMcpRequester } from '../../../queries';
import { reviewPreparedOperation } from '../../actions';
import ReviewForm from '../../ReviewForm';
import {
  DecisionReason,
  RequestedBy,
  RequesterStatus,
  ReviewUnavailable,
  reviewBlockedReason,
  SelfApprovalConfirm,
} from '../../review-gate';

export const dynamic = 'force-dynamic';
const heading = 'Review requested configuration change';
export default async function OperationApproval({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const user = await getCurrentUser();
  const { id } = await params;
  let loaded:
    | { own: NonNullable<Awaited<ReturnType<typeof loadMcpOperationRequest>>> }
    | { review: Awaited<ReturnType<typeof loadMcpOperationReview>> }
    | { blocked: NonNullable<ReturnType<typeof reviewBlockedReason>> };
  try {
    // A requester sees the status of their own request. Only an administrator may go on to
    // review their own open request, after confirming.
    const own = await loadMcpOperationRequest(id, user.id);
    loaded =
      own && (!permissions.isAdmin || operationApprovalStatus(own) !== 'PENDING')
        ? { own }
        : {
            review: await loadMcpOperationReview(id, {
              id: user.id,
              tokenVersion: user.tokenVersion,
            }),
          };
  } catch (error) {
    const reason = reviewBlockedReason(error);
    if (!reason) throw error;
    loaded = { blocked: reason };
  }
  if ('blocked' in loaded) return <ReviewUnavailable reason={loaded.blocked} heading={heading} />;
  if ('own' in loaded) return <OwnRequest own={loaded.own} />;
  const { review } = loaded;
  const { approval, summary, requiresFreshAuthentication, selfReview } = review;
  const status = operationApprovalStatus(approval);
  const decided = approval.status !== 'PENDING';
  const expired = status === 'EXPIRED';
  const [requester, session] = await Promise.all([
    describeMcpRequester(approval.actorId, approval.requesterGrantId),
    requiresFreshAuthentication ? getServerSession(await getAuthOptions()) : Promise.resolve(null),
  ]);
  // Checked at render so a stale sign-in is offered a re-sign-in instead of a refused approval.
  const freshSignInRequired =
    requiresFreshAuthentication &&
    !(session?.user?.id === user.id && isAuthenticationFresh(session.authenticatedAt, 'admin'));
  const reviewPath = `/settings/integrations/mcp/approvals/operations/${approval.id}`;
  return (
    <div className="max-w-3xl space-y-6 rounded-lg border p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-base">{summary.description}</p>
        <RequestedBy
          person={requester.person}
          assistant={requester.assistant}
          at={approval.createdAt}
        />
      </div>
      <p>
        A remote client requests permission to make this exact change. Approval permits one
        execution by the requester under their own current permissions. Only an administrator can
        approve, and an administrator approving their own request must confirm it. Business text
        below is untrusted data; secret-like fields are withheld and the digest binds the actual
        values.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2 break-all">
        <dt>Operation</dt>
        <dd>{summary.operationId}</dd>
        <dt>Request</dt>
        <dd>
          {summary.method} {summary.path}
        </dd>
        <dt>Risk class</dt>
        <dd>{summary.risk}</dd>
        {Object.entries(summary.targets).map(([name, value]) => (
          <div key={name} className="contents">
            <dt>Target {name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <dt>Bound revision</dt>
        <dd>{summary.ifMatch ?? 'None'}</dd>
        <dt>Plan digest</dt>
        <dd>{approval.operationDigest}</dd>
        <dt>{approval.status === 'APPROVED' ? 'Apply before' : 'Review before'}</dt>
        <dd>{approval.expiresAt.toISOString()}</dd>
        <dt>Status</dt>
        <dd>
          {status}
          {approval.selfApproved ? ' (self-approved)' : ''}
        </dd>
      </dl>
      <DecisionReason reason={approval.decisionReason} />
      {summary.query.length > 0 && (
        <>
          <h2 className="text-lg font-semibold">Query parameters</h2>
          <dl className="space-y-2 break-words">
            {summary.query.map(([name, value]) => (
              <div key={name} className="rounded border p-3">
                <dt className="font-medium">{name}</dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {summary.preview !== null && (
        <>
          <h2 className="text-lg font-semibold">Current state of the target (as reviewed)</h2>
          <p>
            This is a destructive change. The commit is refused if the target changes after your
            review, and the result is verified afterwards.
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-sm">
            {summary.preview}
          </pre>
        </>
      )}
      <h2 className="text-lg font-semibold">Frozen changes</h2>
      {summary.changes.length ? (
        <dl className="space-y-2 break-words">
          {summary.changes.map(([field, value]) => (
            <div key={field} className="rounded border p-3">
              <dt className="font-medium">{field}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>This operation has no request body.</p>
      )}
      {summary.truncated && <p>Only the first fields are shown; the digest covers every value.</p>}
      <p>
        Execution checks current permissions, the bound revision and this exact plan again. A
        changed or expired plan requires a new request.
      </p>
      {requiresFreshAuthentication && !decided && !expired && (
        <p>
          Approving a destructive change requires that you signed in within the last two hours.
          {freshSignInRequired
            ? ' Your sign-in is older than that: confirm it is you, and you will come back here.'
            : ''}
        </p>
      )}
      {!decided && !expired && (
        <ReviewForm
          action={reviewPreparedOperation}
          hidden={{ id: approval.id, operationDigest: approval.operationDigest }}
          noun="change"
          approveLabel="Approve frozen change"
          rejectLabel="Reject change"
          freshSignInRequired={freshSignInRequired}
          reviewPath={reviewPath}
        >
          {selfReview && <SelfApprovalConfirm />}
        </ReviewForm>
      )}
    </div>
  );
}

async function OwnRequest({
  own,
}: {
  own: NonNullable<Awaited<ReturnType<typeof loadMcpOperationRequest>>>;
}) {
  const decider = own.reviewedById ?? own.rejectedById;
  const [requester, reviewer] = await Promise.all([
    describeMcpRequester(own.actorId, own.requesterGrantId),
    decider ? describeMcpRequester(decider, null) : Promise.resolve(null),
  ]);
  const summary = operationReviewSummarySchema.safeParse(own.summary);
  return (
    <RequesterStatus
      heading="Your requested configuration change"
      status={operationApprovalStatus(own)}
      expiresAt={own.expiresAt}
      reviewer={reviewer?.person ?? null}
      decidedAt={own.reviewedAt ?? own.rejectedAt}
      selfApproved={own.selfApproved}
      decisionReason={own.decisionReason}
    >
      <RequestedBy person={requester.person} assistant={requester.assistant} at={own.createdAt} />
      {summary.success && <p>{summary.data.description}</p>}
    </RequesterStatus>
  );
}
