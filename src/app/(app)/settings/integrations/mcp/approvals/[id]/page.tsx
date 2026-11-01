import Link from 'next/link';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { requireMcp } from '@/lib/mcp/core/errors';
import { loadMcpRunbookReview } from '@/lib/mcp/approvals/runbook';
import { reviewPreparedRunbook } from '../actions';
import { ReviewUnavailable, reviewBlockedReason, SelfApprovalConfirm } from '../review-gate';

export const dynamic = 'force-dynamic';
export default async function RunbookApproval({ params }: { params: Promise<{ id: string }> }) {
  const heading = 'Review requested runbook execution';
  let review: Awaited<ReturnType<typeof loadMcpRunbookReview>>;
  try {
    const permissions = await getUserPermissions();
    requireMcp(
      permissions.capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE),
      'MCP_APPROVER_REQUIRED',
      403
    );
    const user = await getCurrentUser();
    const { id } = await params;
    review = await loadMcpRunbookReview(id, { id: user.id, tokenVersion: user.tokenVersion });
  } catch (error) {
    const reason = reviewBlockedReason(error);
    if (!reason) throw error;
    return <ReviewUnavailable reason={reason} heading={heading} />;
  }
  const { preview, summary, selfReview } = review;
  const decided = Boolean(preview.reviewedAt || preview.rejectedAt);
  return (
    <div className="max-w-3xl space-y-6 rounded-lg border p-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p>
        A remote client requests permission to start this frozen plan. Approval permits one
        execution; existing step approvals and Agent policies still apply. Business text below is
        untrusted data.
      </p>
      <p>
        Only an approver can approve, and an administrator approving their own request must confirm
        it. Input values are withheld under the runbook review policy; the plan digest binds the
        actual inputs, version, target and response context.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2 break-all">
        <dt>Runbook</dt>
        <dd>
          <Link className="underline" href={`/runbooks/${summary.runbookId}`}>
            {summary.runbookId}
          </Link>
        </dd>
        <dt>Version</dt>
        <dd>
          {summary.version} · {summary.versionId}
        </dd>
        <dt>Version checksum</dt>
        <dd>{summary.checksum}</dd>
        <dt>Plan digest</dt>
        <dd>{preview.planDigest}</dd>
        <dt>Incident</dt>
        <dd>{summary.incidentId ?? 'None'}</dd>
        <dt>Service</dt>
        <dd>{summary.serviceId ?? 'None'}</dd>
        <dt>Agent / pool</dt>
        <dd>{summary.agentId ?? summary.agentPoolId ?? 'Control-plane actions only'}</dd>
        <dt>Expires</dt>
        <dd>{preview.expiresAt.toISOString()}</dd>
        <dt>Status</dt>
        <dd>
          {preview.rejectedAt ? 'Rejected' : preview.reviewedAt ? 'Approved' : 'Awaiting review'}
        </dd>
      </dl>
      <h2 className="text-lg font-semibold">Frozen actions</h2>
      {summary.steps.map(step => (
        <section key={step.key} className="space-y-2 rounded border p-4">
          <h3 className="font-semibold">{step.name}</h3>
          <p>
            {step.type} · {step.risk}
          </p>
          <dl className="space-y-2 break-words">
            {step.configuration.map(([label, value]) => (
              <div key={label}>
                <dt className="font-medium">{label}</dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p>
        Execution checks current permissions and the plan again. A changed or expired plan requires
        a new request.
      </p>
      {!decided && (
        <form action={reviewPreparedRunbook} className="flex flex-wrap gap-4">
          <input type="hidden" name="id" value={preview.id} />
          <input type="hidden" name="planDigest" value={preview.planDigest} />
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
            Reject plan
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="rounded bg-primary px-4 py-3 text-primary-foreground"
          >
            Approve frozen plan
          </button>
        </form>
      )}
    </div>
  );
}
