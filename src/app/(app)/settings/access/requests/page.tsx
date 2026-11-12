import Link from 'next/link';
import { CheckCircle2, History, Inbox, Lock, Route, Users } from 'lucide-react';

import prisma from '@/lib/prisma';
import { requirePageAccessSnapshot } from '@/lib/access/server';
import {
  describeAccessRequest,
  effectiveAccessRequestStatus,
  getReviewableAccessRequest,
  listDecidableAccessRequests,
  listRecentAccessRequestHistory,
} from '@/lib/access/requests';
import { roleLabel, type AppRole } from '@/lib/authorization';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  ListEmpty,
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
} from '@/components/settings/mcp/McpListKit';
import { PersonCell, RequestStatusPill, SectionBody } from '@/components/access/AccessUi';
import { DecideRequestControls } from '@/components/access/AccessControls';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type ReviewRequest = Awaited<ReturnType<typeof listDecidableAccessRequests>>[number];

function RequestDetails({
  request,
  now,
  timeZone,
}: {
  request: ReviewRequest;
  now: Date;
  timeZone: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <PersonCell
          name={request.requester.name}
          email={request.requester.email}
          meta={`${roleLabel(request.requester.role as AppRole)}${
            request.requester.name ? ` · ${request.requester.email}` : ''
          }`}
        />
        <span className="shrink-0 text-xs text-muted-foreground sm:pt-1">
          Requested <RelativeTime value={request.createdAt} now={now} timeZone={timeZone} />
        </span>
      </div>
      <p className="text-sm text-foreground">
        {request.kind === 'ORG_ROLE' ? 'Asks for ' : 'Asks to '}
        <strong className="font-semibold">{requestSummary(request)}</strong>
      </p>
      <blockquote className="rounded-r-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground">
        {request.reason}
      </blockquote>
      {request.originPath && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Route className="h-3.5 w-3.5" aria-hidden="true" />
          Blocked while opening{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {request.originPath}
          </code>
        </p>
      )}
    </div>
  );
}

/** "join "Payments" as member…" reads naturally after "Asks to". */
function requestSummary(request: ReviewRequest) {
  const text = describeAccessRequest(request);
  return request.kind === 'ORG_ROLE' ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

function decisionText(request: ReviewRequest, status: string, timeZone: string) {
  const when = request.decidedAt
    ? ` on ${formatDateTime(request.decidedAt, timeZone, { format: 'short' })}`
    : '';
  const by = request.decidedByName ? ` by ${request.decidedByName}` : '';
  if (status === 'APPROVED') return `Approved${by}${when}`;
  if (status === 'DENIED') return `Declined${by}${when}`;
  if (status === 'CANCELLED') return 'Cancelled by the requester';
  if (status === 'EXPIRED') return 'Expired before anyone decided it';
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
  const now = new Date();
  const [pending, history, focused, viewer] = await Promise.all([
    listDecidableAccessRequests(approver),
    listRecentAccessRequestHistory(approver),
    focusId ? getReviewableAccessRequest(approver, focusId) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: access.userId }, select: { timeZone: true } }),
  ]);
  const timeZone = getUserTimeZone(viewer ?? undefined);
  const managedTeams = access.teams.filter(team => team.role === 'OWNER' || team.role === 'ADMIN');
  const managesTeams = approver.canManageTeams && managedTeams.length > 0;
  const focusedStatus = focused ? effectiveAccessRequestStatus(focused, now) : null;
  const focusedIsPendingHere = Boolean(
    focused && pending.some(request => request.id === focused.id)
  );
  const approvedCount = history.filter(
    request => effectiveAccessRequestStatus(request, now) === 'APPROVED'
  ).length;

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
        stats={[
          {
            label: 'Waiting',
            value: `${pending.length}`,
            icon: <Inbox className="h-3.5 w-3.5" />,
            subtext: 'Need a decision',
          },
          {
            label: 'Approved',
            value: `${approvedCount}`,
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            subtext: 'Last 30 days',
          },
          {
            label: 'Scope',
            value: isOrgAdmin
              ? 'Org-wide'
              : `${managedTeams.length} ${managedTeams.length === 1 ? 'team' : 'teams'}`,
            icon: <Users className="h-3.5 w-3.5" />,
            subtext: 'You can review',
          },
        ]}
      />

      {focusId && !focusedIsPendingHere && (
        <section
          role="status"
          aria-label="Linked request"
          data-testid="access-request-focus"
          className="rounded-xl border border-border bg-card shadow-sm"
        >
          {!focused ? (
            <div className="flex items-start gap-3 p-5">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  This request isn’t available to you
                </p>
                <p className="text-sm text-muted-foreground">
                  It may belong to a team you don’t manage, or it was removed.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                <RequestStatusPill status={focusedStatus!} />
                <span className="text-sm font-medium text-foreground">
                  {decisionText(focused, focusedStatus!, timeZone)}
                </span>
              </div>
              <div className="space-y-3 p-5">
                <RequestDetails request={focused} now={now} timeZone={timeZone} />
                {focusedStatus === 'PENDING' && focused.requesterId === access.userId && (
                  <p className="text-xs text-muted-foreground">
                    This is your request. Someone else must review it.{' '}
                    <Link href="/settings/access" className="font-medium text-primary underline">
                      Track it on My access
                    </Link>
                    .
                  </p>
                )}
                {focused.decisionNote && (
                  <p className="text-xs text-muted-foreground">
                    Note from the reviewer: “{focused.decisionNote}”
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <SettingsSection
        title="Waiting for a decision"
        description={`Approving can grant access permanently or for a limited time. Every decision is recorded in the audit log${
          access.settings.selfApprovalAllowed ? '.' : ', and you cannot approve your own request.'
        }`}
        action={
          pending.length > 0 ? (
            <span className="inline-flex h-7 items-center rounded-full bg-amber-500/15 px-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
              {pending.length} waiting
            </span>
          ) : undefined
        }
      >
        {pending.length === 0 ? (
          <ListEmpty
            icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
            title={
              isOrgAdmin || managesTeams ? 'You’re all caught up' : 'Nothing for you to review'
            }
          >
            {isOrgAdmin || managesTeams
              ? 'New requests appear here and in your notifications.'
              : 'You can review requests for teams you own or administer. You don’t manage any team yet.'}
          </ListEmpty>
        ) : (
          <SectionBody>
            <ul className="space-y-4">
              {pending.map(request => (
                <li
                  key={request.id}
                  id={`request-${request.id}`}
                  data-testid="access-request-item"
                  className={cn(
                    'scroll-mt-28 overflow-hidden rounded-lg border border-border bg-card p-0 shadow-xs',
                    request.id === focusId && 'border-primary/50 ring-2 ring-primary/25'
                  )}
                >
                  <div className="p-4 md:p-5">
                    <RequestDetails request={request} now={now} timeZone={timeZone} />
                  </div>
                  <div className="border-t border-border bg-muted/30 px-4 py-3 md:px-5">
                    <DecideRequestControls
                      requestId={request.id}
                      requestedDuration={request.durationMinutes}
                      isOwnRequest={
                        request.requesterId === access.userId &&
                        !access.settings.selfApprovalAllowed
                      }
                      requestKind={request.kind}
                      roleManagedExternally={request.requester.roleSource !== 'MANUAL'}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </SectionBody>
        )}
      </SettingsSection>

      <SettingsSection
        title="Recently decided"
        description="Requests you could review that were decided, cancelled or expired in the last 30 days."
      >
        {history.length === 0 ? (
          <ListEmpty
            icon={<History className="h-5 w-5" aria-hidden="true" />}
            title="No decisions yet"
          >
            Approved, declined, cancelled and expired requests show here for 30 days.
          </ListEmpty>
        ) : (
          <div className="-mx-4 md:-mx-6">
            <ResponsiveTable
              caption="Recently decided access requests"
              columns={[
                { label: 'Person' },
                { label: 'Request' },
                { label: 'Outcome' },
                { label: 'Details' },
              ]}
            >
              {history.map(request => {
                const status = effectiveAccessRequestStatus(request, now);
                return (
                  <ResponsiveRow key={request.id}>
                    <ResponsiveCell label="Person" primary>
                      <PersonCell name={request.requester.name} email={request.requester.email} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Request">
                      {describeAccessRequest(request)}
                    </ResponsiveCell>
                    <ResponsiveCell label="Outcome">
                      <RequestStatusPill status={status} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Details" className="text-xs text-muted-foreground">
                      {decisionText(request, status, timeZone)}
                      {request.decisionNote && (
                        <span className="mt-0.5 block italic">“{request.decisionNote}”</span>
                      )}
                    </ResponsiveCell>
                  </ResponsiveRow>
                );
              })}
            </ResponsiveTable>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
