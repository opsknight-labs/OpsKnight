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
import { cn } from '@/lib/utils';
import { Deadline } from '@/components/settings/mcp/McpListKit';
import {
  RISK_PILL_CLASS,
  highestRunbookStepRisk,
  runbookStepRiskMeta,
} from '@/components/settings/mcp/risk';
import { describeMcpRequester, loadMcpViewer, type McpViewer } from '../../queries';
import { reviewPreparedRunbook } from '../actions';
import ReviewForm from '../ReviewForm';
import {
  BackToApprovals,
  DD_CLASS,
  DT_CLASS,
  DecisionReason,
  RequestedBy,
  ReviewIntro,
  statusLabel,
  RequesterStatus,
  ReviewUnavailable,
  reviewBlockedReason,
  SelfApprovalConfirm,
} from '../review-gate';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export default async function RunbookApproval({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess('/settings/integrations/mcp/approvals/[id]');
  const heading = 'Review requested runbook execution';
  let loaded:
    | { own: NonNullable<Awaited<ReturnType<typeof loadMcpRunbookRequest>>> }
    | { review: Awaited<ReturnType<typeof loadMcpRunbookReview>> }
    | { blocked: NonNullable<ReturnType<typeof reviewBlockedReason>> };
  let viewer: McpViewer | null = null;
  try {
    const permissions = await getUserPermissions();
    requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
    const user = await getCurrentUser();
    viewer = await loadMcpViewer(permissions);
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
  // Set before anything that can reach `loaded`; asserted for the type checker.
  requireMcp(viewer, 'MCP_LOGIN_REQUIRED', 401);
  if ('own' in loaded) return <OwnPlan own={loaded.own} timeZone={viewer.timeZone} />;
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
  const highest = highestRunbookStepRisk(summary.steps.map(step => step.risk));
  const highestMeta = highest ? runbookStepRiskMeta(highest) : null;
  const status = runbookApprovalStatus(preview);
  return (
    <div className="max-w-3xl space-y-6 rounded-lg border p-6">
      <BackToApprovals />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        {runbook && <p className="text-base">Run “{runbook.name}”</p>}
        <RequestedBy
          person={requester.person}
          assistant={requester.assistant}
          at={preview.createdAt}
          timeZone={viewer.timeZone}
        />
      </div>
      <ReviewIntro />
      <p className="text-sm text-muted-foreground">
        Existing step approvals and Agent policies still apply. Input values are withheld under the
        runbook review policy.
      </p>
      <dl className="grid gap-x-4 gap-y-3 break-words sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <dt className={DT_CLASS}>Runbook</dt>
        <dd className={DD_CLASS}>
          <Link className="underline" href={`/runbooks/${summary.runbookId}`}>
            {runbook?.name ?? summary.runbookId}
          </Link>
        </dd>
        <dt className={DT_CLASS}>Incident</dt>
        <dd className={DD_CLASS}>
          {summary.incidentId ? (
            <Link className="underline" href={`/incidents/${summary.incidentId}`}>
              {incident?.title ?? summary.incidentId}
            </Link>
          ) : (
            'None'
          )}
        </dd>
        <dt className={DT_CLASS}>Service</dt>
        <dd className={DD_CLASS}>
          {summary.serviceId ? (
            <Link className="underline" href={`/services/${summary.serviceId}`}>
              {service?.name ?? summary.serviceId}
            </Link>
          ) : (
            'None'
          )}
        </dd>
        <dt className={DT_CLASS}>Agent / pool</dt>
        <dd className={DD_CLASS}>
          {summary.agentId ?? summary.agentPoolId ?? 'Control-plane actions only'}
        </dd>
        <dt className={DT_CLASS}>Highest step risk</dt>
        <dd className={DD_CLASS}>
          {highest && highestMeta ? (
            <span className={cn(RISK_PILL_CLASS, highestMeta.className)}>{highestMeta.title}</span>
          ) : (
            'No steps'
          )}
        </dd>
        <dt className={DT_CLASS}>{preview.reviewedAt ? 'Start before' : 'Review before'}</dt>
        <dd className={DD_CLASS}>
          <Deadline value={preview.expiresAt} now={new Date()} timeZone={viewer.timeZone} />
        </dd>
        <dt className={DT_CLASS}>Status</dt>
        <dd className={DD_CLASS}>
          {statusLabel(status)}
          {preview.selfApproved ? ' (self-approved)' : ''}
        </dd>
      </dl>
      <DecisionReason reason={preview.decisionReason} />
      {summary.inputs.length > 0 && (
        <section className="space-y-2 rounded border p-4" aria-labelledby="runbook-inputs">
          <h2 id="runbook-inputs" className="text-lg font-semibold">
            Inputs the assistant supplied
          </h2>
          <p className="text-sm text-muted-foreground">
            These values are used in the actions below. Credentials are never shown, and a value
            that was shortened or partly hidden says so.
          </p>
          <dl className="space-y-2 break-words">
            {summary.inputs.map(input => (
              <div key={input.key}>
                <dt className="font-medium">
                  {input.key} <span className="text-xs text-muted-foreground">({input.type})</span>
                </dt>
                <dd className="whitespace-pre-wrap">{input.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <h2 className="text-lg font-semibold">Frozen actions</h2>
      {summary.steps.map(step => (
        <section key={step.key} className="space-y-2 rounded border p-4">
          <h3 className="font-semibold">{step.name}</h3>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>{step.type}</span>
            <span className={cn(RISK_PILL_CLASS, runbookStepRiskMeta(step.risk).className)}>
              {runbookStepRiskMeta(step.risk).title}
            </span>
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
      <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm font-medium">Verification details</summary>
        <dl className="grid gap-x-4 gap-y-3 break-all pt-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <dt className={DT_CLASS}>Runbook id</dt>
          <dd className={DD_CLASS}>{summary.runbookId}</dd>
          <dt className={DT_CLASS}>Version</dt>
          <dd className={DD_CLASS}>
            {summary.version} · {summary.versionId}
          </dd>
          <dt className={DT_CLASS}>Version checksum</dt>
          <dd className={DD_CLASS}>{summary.checksum}</dd>
          <dt className={DT_CLASS}>Plan digest</dt>
          <dd className={DD_CLASS}>{preview.planDigest}</dd>
        </dl>
      </details>
      {!decided && (
        <ReviewForm
          action={reviewPreparedRunbook}
          hidden={{ id: preview.id, planDigest: preview.planDigest }}
          noun="runbook run"
          approveLabel="Approve frozen plan"
          rejectLabel="Reject plan"
          reviewPath={`/settings/integrations/mcp/approvals/${preview.id}`}
          selfReview={selfReview}
        >
          {selfReview && <SelfApprovalConfirm />}
        </ReviewForm>
      )}
    </div>
  );
}

async function OwnPlan({
  own,
  timeZone,
}: {
  own: NonNullable<Awaited<ReturnType<typeof loadMcpRunbookRequest>>>;
  timeZone: string;
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
      timeZone={timeZone}
    >
      <RequestedBy
        person={requester.person}
        assistant={requester.assistant}
        at={own.createdAt}
        timeZone={timeZone}
      />
      {runbook && <p>Runbook: {runbook.name}</p>}
    </RequesterStatus>
  );
}
