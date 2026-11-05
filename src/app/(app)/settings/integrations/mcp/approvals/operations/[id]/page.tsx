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
  type OperationDiffRow,
} from '@/lib/mcp/approvals/operation';
import { cn } from '@/lib/utils';
import { Deadline } from '@/components/settings/mcp/McpListKit';
import { RISK_PILL_CLASS, riskLabel, riskMeta } from '@/components/settings/mcp/risk';
import { describeMcpRequester, loadMcpViewer } from '../../../queries';
import { reviewPreparedOperation } from '../../actions';
import ReviewForm from '../../ReviewForm';
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
} from '../../review-gate';

export const dynamic = 'force-dynamic';
const heading = 'Review requested configuration change';
export default async function OperationApproval({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const [user, viewer] = await Promise.all([getCurrentUser(), loadMcpViewer(permissions)]);
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
  if ('own' in loaded) return <OwnRequest own={loaded.own} timeZone={viewer.timeZone} />;
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
  const now = new Date();
  const risk = riskMeta(summary.risk);
  const changed = summary.diff.filter(row => row.status !== 'unchanged');
  const unchanged = summary.diff.filter(row => row.status === 'unchanged');
  return (
    <div className="max-w-3xl space-y-6 rounded-lg border p-6">
      <BackToApprovals />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-base">{summary.description}</p>
        <RequestedBy
          person={requester.person}
          assistant={requester.assistant}
          at={approval.createdAt}
          timeZone={viewer.timeZone}
        />
      </div>
      <ReviewIntro />
      <dl className="grid gap-x-4 gap-y-3 break-words sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <dt className={DT_CLASS}>Change</dt>
        <dd className={DD_CLASS}>{summary.description}</dd>
        {Object.entries(summary.targets).map(([name, value]) => (
          <div key={name} className="contents">
            <dt className={DT_CLASS}>Target {name}</dt>
            <dd className={DD_CLASS}>{value}</dd>
          </div>
        ))}
        <dt className={DT_CLASS}>Risk</dt>
        <dd className={DD_CLASS}>
          <span className={cn(RISK_PILL_CLASS, risk.className)}>{riskLabel(summary.risk)}</span>
        </dd>
        <dt className={DT_CLASS}>
          {approval.status === 'APPROVED' ? 'Apply before' : 'Review before'}
        </dt>
        <dd className={DD_CLASS}>
          <Deadline value={approval.expiresAt} now={now} timeZone={viewer.timeZone} />
        </dd>
        <dt className={DT_CLASS}>Status</dt>
        <dd className={DD_CLASS}>
          {statusLabel(status)}
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
      {summary.diff.length > 0 ? (
        <>
          <h2 className="text-lg font-semibold">What changes</h2>
          <p className="text-sm text-muted-foreground">
            Compared with the target when the request was made. Display only: the approval binds the
            new values, not this comparison.
          </p>
          <DiffTable rows={changed} />
          {unchanged.length > 0 && (
            <details className="rounded border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {unchanged.length} unchanged {unchanged.length === 1 ? 'field' : 'fields'}
              </summary>
              <div className="pt-3">
                <DiffTable rows={unchanged} />
              </div>
            </details>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
      {summary.truncated && <p>Only the first fields are shown; the digest covers every value.</p>}
      {summary.preview !== null && (
        <>
          <p>
            This is a destructive change. The commit is refused if the target changes after your
            review, and the result is verified afterwards.
          </p>
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">Full current state</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
              {summary.preview}
            </pre>
          </details>
        </>
      )}
      <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm font-medium">Verification details</summary>
        <dl className="grid gap-x-4 gap-y-3 break-all pt-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <dt className={DT_CLASS}>Operation id</dt>
          <dd className={DD_CLASS}>{summary.operationId}</dd>
          <dt className={DT_CLASS}>Request</dt>
          <dd className={DD_CLASS}>
            {summary.method} {summary.path}
          </dd>
          <dt className={DT_CLASS}>Bound revision</dt>
          <dd className={DD_CLASS}>{summary.ifMatch ?? 'None'}</dd>
          <dt className={DT_CLASS}>Plan digest</dt>
          <dd className={DD_CLASS}>{approval.operationDigest}</dd>
        </dl>
      </details>
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
          selfReview={selfReview}
        >
          {selfReview && <SelfApprovalConfirm />}
        </ReviewForm>
      )}
    </div>
  );
}

const DIFF_STATUS = new Map([
  ['changed', 'Changed'],
  ['unchanged', 'Unchanged'],
  ['not_in_view', 'Not in current view'],
]);

/** Before and after for each field; values come from the request and are untrusted text. */
function DiffTable({ rows }: { rows: OperationDiffRow[] }) {
  if (!rows.length) return <p className="text-sm">No field differs from the current state.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Changed fields, before and after</caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className={cn(DT_CLASS, 'w-1/4 py-2 pr-3 font-normal')}>
              Field
            </th>
            <th scope="col" className={cn(DT_CLASS, 'py-2 pr-3 font-normal')}>
              Before
            </th>
            <th scope="col" className={cn(DT_CLASS, 'py-2 font-normal')}>
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.field} className="border-b align-top last:border-0">
              <th scope="row" className="break-words py-2 pr-3 text-left font-medium">
                {row.field}
                <span className="block text-xs font-normal text-muted-foreground">
                  {DIFF_STATUS.get(row.status)}
                </span>
              </th>
              <td className="whitespace-pre-wrap break-words py-2 pr-3 text-muted-foreground">
                {row.before ?? '—'}
              </td>
              <td className="whitespace-pre-wrap break-words py-2">{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function OwnRequest({
  own,
  timeZone,
}: {
  own: NonNullable<Awaited<ReturnType<typeof loadMcpOperationRequest>>>;
  timeZone: string;
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
      timeZone={timeZone}
    >
      <RequestedBy
        person={requester.person}
        assistant={requester.assistant}
        at={own.createdAt}
        timeZone={timeZone}
      />
      {summary.success && <p>{summary.data.description}</p>}
    </RequesterStatus>
  );
}
