import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { requireMcp } from '@/lib/mcp/core/errors';
import { loadMcpOperationReview } from '@/lib/mcp/approvals/operation';
import { reviewPreparedOperation } from '../../actions';
import { ReviewUnavailable, reviewBlockedReason, SelfApprovalConfirm } from '../../review-gate';

export const dynamic = 'force-dynamic';
export default async function OperationApproval({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const user = await getCurrentUser();
  const { id } = await params;
  let review: Awaited<ReturnType<typeof loadMcpOperationReview>>;
  try {
    review = await loadMcpOperationReview(id, { id: user.id, tokenVersion: user.tokenVersion });
  } catch (error) {
    const reason = reviewBlockedReason(error);
    if (!reason) throw error;
    return <ReviewUnavailable reason={reason} heading="Review requested configuration change" />;
  }
  const { approval, summary, requiresFreshAuthentication, selfReview } = review;
  const decided = approval.status !== 'PENDING';
  const expired = approval.status === 'PENDING' && approval.expiresAt <= new Date();
  return (
    <div className="max-w-3xl space-y-6 rounded-lg border p-6">
      <h1 className="text-2xl font-semibold">Review requested configuration change</h1>
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
        <dt>Expires</dt>
        <dd>{approval.expiresAt.toISOString()}</dd>
        <dt>Status</dt>
        <dd>{expired ? 'Expired' : approval.status}</dd>
      </dl>
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
          Approving requires that you signed in within the last two hours. If approval is refused,
          sign out and sign in again, then return to this page.
        </p>
      )}
      {!decided && !expired && (
        <form action={reviewPreparedOperation} className="flex flex-wrap gap-4">
          <input type="hidden" name="id" value={approval.id} />
          <input type="hidden" name="operationDigest" value={approval.operationDigest} />
          {selfReview && (
            <div className="w-full">
              <SelfApprovalConfirm />
            </div>
          )}
          <button
            type="submit"
            name="decision"
            value="reject"
            formNoValidate
            className="rounded border px-4 py-3"
          >
            Reject change
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="rounded bg-primary px-4 py-3 text-primary-foreground"
          >
            Approve frozen change
          </button>
        </form>
      )}
    </div>
  );
}
