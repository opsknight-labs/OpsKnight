import Link from 'next/link';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { requireMcp } from '@/lib/mcp/core/errors';
import prisma from '@/lib/prisma';
import {
  loadMcpRunbookRequest,
  loadMcpRunbookReview,
  runbookApprovalStatus,
} from '@/lib/mcp/approvals/runbook';
import { describeMcpRequester } from '../../queries';
import { reviewPreparedRunbook } from '../actions';
import ReviewForm from '../ReviewForm';
import {
  DecisionReason,
  RequestedBy,
  RequesterStatus,
  ReviewUnavailable,
  reviewBlockedReason,
  SelfApprovalConfirm,
} from '../review-gate';

export const dynamic = 'force-dynamic';
export default async function RunbookApproval({ params }: { params: Promise<{ id: string }> }) {
  const heading = 'Review requested runbook execution';
  let loaded:
    | { own: NonNullable<Awaited<ReturnType<typeof loadMcpRunbookRequest>>> }
    | { review: Awaited<ReturnType<typeof loadMcpRunbookReview>> }
    | { blocked: NonNullable<ReturnType<typeof reviewBlockedReason>> };
  try {
    const permissions = await getUserPermissions();
    requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
    const user = await getCurrentUser();
    const { id } = await params;
    // A requester sees the status of their own plan; only an administrator may go on to review
    // their own open plan, after confirming.
    const own = await loadMcpRunbookRequest(id, user.id);
    if (own && (!permissions.isAdmin || runbookApprovalStatus(own) !== 'PENDING')) {
      loaded = { own };
    } else {
      requireMcp(
        permissions.capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE),
        'MCP_APPROVER_REQUIRED',
        403
      );
      loaded = {
        review: await loadMcpRunbookReview(id, { id: user.id, tokenVersion: user.tokenVersion }),
      };
    }
  } catch (error) {
    const reason = reviewBlockedReason(error);
    if (!reason) throw error;
    loaded = { blocked: reason };
  }
  if ('blocked' in loaded) return <ReviewUnavailable reason={loaded.blocked} heading={heading} />;
  if ('own' in loaded) return <OwnPlan own={loaded.own} />;
  const { review } = loaded;
  const { preview, summary, selfReview } = review;
  const decided = Boolean(preview.reviewedAt || preview.rejectedAt);
  // Descriptive only, outside the digest: names help the reviewer recognise the targets.
  const [requester, runbook, incident, service] = await Promise.all([
    describeMcpRequester(preview.actorId, preview.requesterGrantId),
    prisma.runbook.findUnique({ where: { id: summary.runbookId }, select: { name: true } }),
    summary.incidentId
      ? prisma.incident.findUnique({ where: { id: summary.incidentId }, select: { title: true } })
      : Promise.resolve(null),
    summary.serviceId
      ? prisma.service.findUnique({ where: { id: summary.serviceId }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  return (
    <div className="max-w-3xl space-y-6 rounded-lg border p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        {runbook && <p className="text-base">Run “{runbook.name}”</p>}
        <RequestedBy
          person={requester.person}
          assistant={requester.assistant}
          at={preview.createdAt}
        />
      </div>
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
        <dd>
          {summary.incidentId ? (
            <Link className="underline" href={`/incidents/${summary.incidentId}`}>
              {incident?.title ?? summary.incidentId}
            </Link>
          ) : (
            'None'
          )}
        </dd>
        <dt>Service</dt>
        <dd>
          {summary.serviceId ? (
            <Link className="underline" href={`/services/${summary.serviceId}`}>
              {service?.name ?? summary.serviceId}
            </Link>
          ) : (
            'None'
          )}
        </dd>
        <dt>Agent / pool</dt>
        <dd>{summary.agentId ?? summary.agentPoolId ?? 'Control-plane actions only'}</dd>
        <dt>{preview.reviewedAt ? 'Start before' : 'Review before'}</dt>
        <dd>{preview.expiresAt.toISOString()}</dd>
        <dt>Status</dt>
        <dd>
          {preview.rejectedAt ? 'Rejected' : preview.reviewedAt ? 'Approved' : 'Awaiting review'}
          {preview.selfApproved ? ' (self-approved)' : ''}
        </dd>
      </dl>
      <DecisionReason reason={preview.decisionReason} />
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
        <ReviewForm
          action={reviewPreparedRunbook}
          hidden={{ id: preview.id, planDigest: preview.planDigest }}
          noun="runbook run"
          approveLabel="Approve frozen plan"
          rejectLabel="Reject plan"
          reviewPath={`/settings/integrations/mcp/approvals/${preview.id}`}
        >
          {selfReview && <SelfApprovalConfirm />}
        </ReviewForm>
      )}
    </div>
  );
}

async function OwnPlan({
  own,
}: {
  own: NonNullable<Awaited<ReturnType<typeof loadMcpRunbookRequest>>>;
}) {
  const decider = own.reviewedById ?? own.rejectedById;
  const [requester, reviewer, runbook] = await Promise.all([
    describeMcpRequester(own.actorId, own.requesterGrantId),
    decider ? describeMcpRequester(decider, null) : Promise.resolve(null),
    prisma.runbook.findUnique({ where: { id: own.runbookId }, select: { name: true } }),
  ]);
  return (
    <RequesterStatus
      heading="Your requested runbook run"
      status={runbookApprovalStatus(own)}
      expiresAt={own.expiresAt}
      reviewer={reviewer?.person ?? null}
      decidedAt={own.reviewedAt ?? own.rejectedAt}
      selfApproved={own.selfApproved}
      decisionReason={own.decisionReason}
    >
      <RequestedBy person={requester.person} assistant={requester.assistant} at={own.createdAt} />
      {runbook && <p>Runbook: {runbook.name}</p>}
    </RequesterStatus>
  );
}
