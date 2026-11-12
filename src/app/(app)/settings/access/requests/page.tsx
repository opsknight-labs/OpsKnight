import Link from 'next/link';
import { Inbox } from 'lucide-react';

import { requirePageAccessSnapshot } from '@/lib/access/server';
import {
  describeAccessRequest,
  effectiveAccessRequestStatus,
  getReviewableAccessRequest,
  listDecidableAccessRequests,
  listRecentAccessRequestHistory,
} from '@/lib/access/requests';
import { roleLabel, type AppRole } from '@/lib/authorization';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { DecideRequestControls } from '@/components/access/AccessControls';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_STYLES = new Map<string, string>([
  ['PENDING', 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'],
  ['APPROVED', 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'],
  ['DENIED', 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200'],
  ['CANCELLED', 'bg-muted text-muted-foreground'],
  ['EXPIRED', 'bg-muted text-muted-foreground'],
]);

type ReviewRequest = Awaited<ReturnType<typeof listDecidableAccessRequests>>[number];

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
        STATUS_STYLES.get(status) ?? STATUS_STYLES.get('CANCELLED')
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}

function RequestSummary({ request }: { request: ReviewRequest }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <strong>{request.requester.name ?? request.requester.email}</strong>
        <span className="text-muted-foreground">
          ({roleLabel(request.requester.role as AppRole)}) asked for
        </span>
        <strong>{describeAccessRequest(request)}</strong>
      </div>
      <p className="rounded-md bg-muted/40 p-2 text-sm">“{request.reason}”</p>
      <p className="text-xs text-muted-foreground">
        Requested {request.createdAt.toLocaleString()}
        {request.originPath ? ` while opening ${request.originPath}` : ''}
      </p>
    </>
  );
}

function decisionText(request: ReviewRequest, status: string) {
  if (status === 'APPROVED')
    return `Approved${request.decidedByName ? ` by ${request.decidedByName}` : ''}${
      request.decidedAt ? ` on ${request.decidedAt.toLocaleString()}` : ''
    }.`;
  if (status === 'DENIED')
    return `Declined${request.decidedByName ? ` by ${request.decidedByName}` : ''}${
      request.decidedAt ? ` on ${request.decidedAt.toLocaleString()}` : ''
    }.`;
  if (status === 'CANCELLED') return 'Cancelled by the requester.';
  if (status === 'EXPIRED') return 'Expired before anyone decided it.';
  return '';
}

export default async function AccessRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ request?: string }>;
}) {
  const access = await requirePageAccessSnapshot('/settings/access/requests');
  const focusId = (await searchParams)?.request?.slice(0, 64) || null;
  const isOrgAdmin = access.capabilities.includes('admin.manage');
  const approver = {
    id: access.userId,
    isOrgAdmin,
    canManageTeams: access.capabilities.includes('team.administer.scoped'),
  };
  const [pending, history, focused] = await Promise.all([
    listDecidableAccessRequests(approver),
    listRecentAccessRequestHistory(approver),
    focusId ? getReviewableAccessRequest(approver, focusId) : Promise.resolve(null),
  ]);
  const managesTeams =
    approver.canManageTeams &&
    access.teams.some(team => team.role === 'OWNER' || team.role === 'ADMIN');
  const focusedStatus = focused ? effectiveAccessRequestStatus(focused) : null;
  const focusedIsPendingHere = Boolean(
    focused && pending.some(request => request.id === focused.id)
  );

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        tag="Access"
        title="Access requests"
        subtitle={
          isOrgAdmin
            ? 'Review role and team requests from across your organization.'
            : 'Review requests to join the teams you own or administer.'
        }
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <Inbox className="h-8 w-8" />
          </div>
        }
      />

      {focusId && !focusedIsPendingHere && (
        <div
          role="status"
          className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
          data-testid="access-request-focus"
        >
          {!focused ? (
            <p>
              This request isn’t available to you. It may belong to a team you don’t manage, or it
              was removed.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={focusedStatus!} />
                <span className="font-medium">{decisionText(focused, focusedStatus!)}</span>
              </div>
              <RequestSummary request={focused} />
              {focusedStatus === 'PENDING' && focused.requesterId === access.userId && (
                <p className="text-xs text-muted-foreground">
                  This is your request. Someone else must review it.{' '}
                  <Link href="/settings/access" className="text-primary underline">
                    Track it on My access
                  </Link>
                  .
                </p>
              )}
              {focused.decisionNote && (
                <p className="text-xs text-muted-foreground">Note: “{focused.decisionNote}”</p>
              )}
            </div>
          )}
        </div>
      )}

      <SettingsSection
        title={`Waiting for a decision (${pending.length})`}
        description={`Approving can grant access permanently or for a limited time. Every decision is recorded in the audit log${
          access.settings.selfApprovalAllowed ? '.' : ', and you cannot approve your own request.'
        }`}
      >
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isOrgAdmin || managesTeams
              ? 'Nothing to review right now.'
              : 'You can review requests for teams you own or administer. You don’t manage any team yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map(request => (
              <li
                key={request.id}
                id={`request-${request.id}`}
                data-testid="access-request-item"
                className={cn(
                  'space-y-2 py-4',
                  request.id === focusId &&
                    '-mx-3 rounded-lg bg-primary/5 px-3 ring-1 ring-primary/30'
                )}
              >
                <RequestSummary request={request} />
                <DecideRequestControls
                  requestId={request.id}
                  requestedDuration={request.durationMinutes}
                  isOwnRequest={
                    request.requesterId === access.userId && !access.settings.selfApprovalAllowed
                  }
                  requestKind={request.kind}
                  roleManagedExternally={request.requester.roleSource !== 'MANUAL'}
                />
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {history.length > 0 && (
        <SettingsSection
          title="Recently decided"
          description="Requests you could review that were decided, cancelled or expired in the last 30 days."
        >
          <ul className="divide-y divide-border text-sm">
            {history.map(request => {
              const status = effectiveAccessRequestStatus(request);
              return (
                <li key={request.id} className="flex flex-wrap items-center gap-3 py-2">
                  <StatusBadge status={status} />
                  <span className="flex-1">
                    <strong>{request.requester.name ?? request.requester.email}</strong> ·{' '}
                    {describeAccessRequest(request)}
                    <span className="block text-xs text-muted-foreground">
                      {decisionText(request, status)}
                      {request.decisionNote ? ` “${request.decisionNote}”` : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      )}
    </div>
  );
}
