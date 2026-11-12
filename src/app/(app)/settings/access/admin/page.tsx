import Link from 'next/link';
import {
  ArrowRight,
  Clock,
  Download,
  History,
  Inbox,
  ShieldBan,
  ShieldCheck,
  ShieldPlus,
  Siren,
} from 'lucide-react';

import prisma from '@/lib/prisma';
import { requirePageAccessSnapshot } from '@/lib/access/server';
import { getAccessControlSettings } from '@/lib/access/settings';
import { accessDenialInsights, canSelfCertify, listCustomRoles } from '@/lib/access/admin';
import { describeRequirement } from '@/lib/access/catalog';
import { isCapability, roleLabel, type AppRole, type Capability } from '@/lib/authorization';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  Deadline,
  ListEmpty,
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
  type PillTone,
} from '@/components/settings/mcp/McpListKit';
import {
  PersonCell,
  SectionAnchor,
  SectionBody,
  SectionJumpNav,
} from '@/components/access/AccessUi';
import RoleMatrix from '@/components/access/RoleMatrix';
import { EndGrantButton } from '@/components/access/AccessControls';
import {
  AccessChecker,
  AccessPolicyForm,
  AccessReviewItems,
  CustomRolesManager,
  StartAccessReviewForm,
  WhoHasAccess,
} from '@/components/access/AccessAdminPanels';

export const dynamic = 'force-dynamic';

const REVIEW_STATUS = new Map<string, { label: string; tone: PillTone }>([
  ['COMPLETED', { label: 'Completed', tone: 'success' }],
  ['CANCELLED', { label: 'Cancelled', tone: 'neutral' }],
]);

export default async function AccessManagementPage() {
  const access = await requirePageAccessSnapshot('/settings/access/admin');
  const isAdmin = access.capabilities.includes('admin.manage');
  const now = new Date();
  const [
    settings,
    users,
    customRoles,
    grants,
    openReview,
    pastReviews,
    insights,
    pendingRequests,
    viewer,
  ] = await Promise.all([
    getAccessControlSettings(true),
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true, role: true, customRoleId: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: 1000,
    }),
    listCustomRoles(),
    prisma.accessGrant.findMany({
      where: { revokedAt: null, expiresAt: { gt: now } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    }),
    prisma.accessReview.findFirst({
      where: { status: 'OPEN' },
      include: { items: { orderBy: { subjectLabel: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.accessReview.findMany({
      where: { status: { not: 'OPEN' } },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    accessDenialInsights(7),
    prisma.accessRequest.count({ where: { status: 'PENDING', expiresAt: { gt: now } } }),
    prisma.user.findUnique({ where: { id: access.userId }, select: { timeZone: true } }),
  ]);

  const timeZone = getUserTimeZone(viewer ?? undefined);
  const userOptions = users.map(({ id, name, email, role }) => ({ id, name, email, role }));
  const breakGlassActive = grants.filter(grant => grant.source === 'BREAK_GLASS');
  const reviewRemaining = openReview
    ? openReview.items.filter(item => item.decision === 'PENDING').length
    : 0;

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        tag="Workspace & Governance"
        title="Access management"
        subtitle="Roles, custom roles, temporary and emergency access, access reviews, and a checker that explains any access decision."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <ShieldCheck className="h-8 w-8" />
          </div>
        }
        stats={[
          {
            label: 'Requests',
            value: `${pendingRequests}`,
            icon: <Inbox className="h-3.5 w-3.5" />,
            subtext: 'Waiting',
            href: '/settings/access/requests',
          },
          {
            label: 'Temporary',
            value: `${grants.length}`,
            icon: <Clock className="h-3.5 w-3.5" />,
            subtext: 'Active grants',
            href: '#temporary-access',
          },
          {
            label: 'Emergency',
            value: `${breakGlassActive.length}`,
            icon: <Siren className="h-3.5 w-3.5" />,
            subtext: 'Active now',
            href: '#temporary-access',
            valueClassName: breakGlassActive.length > 0 ? 'text-amber-300' : undefined,
          },
          {
            label: 'Custom roles',
            value: `${customRoles.length}`,
            icon: <ShieldPlus className="h-3.5 w-3.5" />,
            subtext: 'Defined',
            href: isAdmin ? '#custom-roles' : undefined,
          },
        ]}
      />

      {breakGlassActive.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <Siren className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {breakGlassActive.length === 1
                ? `${breakGlassActive[0]!.user.name ?? breakGlassActive[0]!.user.email} is using emergency access`
                : `${breakGlassActive.length} people are using emergency access`}
            </p>
            <p className="text-xs opacity-80">
              Check the reason and end it early if the emergency is over.
            </p>
          </div>
          <a
            href="#temporary-access"
            className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            Review
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}

      <SectionJumpNav
        label="Access management sections"
        items={[
          { href: '#access-checker', label: 'Access checker' },
          { href: '#who-has-access', label: 'Who has access' },
          {
            href: '#temporary-access',
            label: 'Temporary access',
            count: grants.length,
            alert: breakGlassActive.length > 0,
          },
          { href: '#access-reviews', label: 'Access reviews', count: reviewRemaining },
          ...(isAdmin ? [{ href: '#custom-roles', label: 'Custom roles' }] : []),
          { href: '#denials', label: 'Most denied', count: insights.length },
          ...(isAdmin ? [{ href: '#access-policy', label: 'Policy' }] : []),
          { href: '#built-in-roles', label: 'Built-in roles' },
        ]}
      />

      <SectionAnchor id="access-checker">
        <SettingsSection
          title="Access checker"
          description="Pick a person and something they tried to do. See whether it is allowed and exactly why, using the same rules that enforce access."
        >
          <SectionBody>
            <AccessChecker users={userOptions} />
          </SectionBody>
        </SettingsSection>
      </SectionAnchor>

      <SectionAnchor id="who-has-access">
        <SettingsSection
          title="Who has access"
          description="Everyone holding a permission through their role, a custom role, or temporary access."
        >
          <SectionBody>
            <WhoHasAccess />
          </SectionBody>
        </SettingsSection>
      </SectionAnchor>

      <SectionAnchor id="temporary-access">
        <SettingsSection
          title="Temporary and emergency access"
          description="Access that ends automatically. End any of it early if it is no longer needed."
        >
          {grants.length === 0 ? (
            <ListEmpty
              icon={<Clock className="h-5 w-5" aria-hidden="true" />}
              title="Nobody has temporary access"
            >
              Approved time-limited requests and emergency access show here until they end.
            </ListEmpty>
          ) : (
            <div className="-mx-4 md:-mx-6">
              <ResponsiveTable
                caption="Temporary and emergency access"
                columns={[
                  { label: 'Person' },
                  { label: 'Access' },
                  { label: 'Ends' },
                  { label: 'Reason' },
                  ...(isAdmin ? [{ label: 'Actions', srOnly: true }] : []),
                ]}
              >
                {grants.map(grant => (
                  <ResponsiveRow key={grant.id}>
                    <ResponsiveCell label="Person" primary>
                      <PersonCell name={grant.user.name} email={grant.user.email} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Access">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-foreground">
                          {grant.role
                            ? roleLabel(grant.role as AppRole)
                            : `Team ${grant.teamRole?.toLowerCase() ?? 'member'}`}
                        </span>
                        {grant.incidentId && <StatusPill tone="neutral">One incident</StatusPill>}
                        {grant.source === 'BREAK_GLASS' && (
                          <StatusPill tone="warning" dot>
                            Emergency
                          </StatusPill>
                        )}
                      </div>
                    </ResponsiveCell>
                    <ResponsiveCell label="Ends">
                      <RelativeTime value={grant.expiresAt} now={now} timeZone={timeZone} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Reason" className="max-w-xs">
                      <span
                        className="line-clamp-2 text-xs text-muted-foreground"
                        title={grant.reason}
                      >
                        {grant.reason}
                      </span>
                    </ResponsiveCell>
                    {isAdmin && (
                      <ResponsiveCell label="Actions" primary align="end">
                        <EndGrantButton grantId={grant.id} label="End access" />
                      </ResponsiveCell>
                    )}
                  </ResponsiveRow>
                ))}
              </ResponsiveTable>
            </div>
          )}
        </SettingsSection>
      </SectionAnchor>

      <SectionAnchor id="access-reviews">
        <SettingsSection
          title="Access reviews"
          description="Periodically confirm that everyone with elevated access still needs it. Completed reviews produce audit evidence (SOC 2 CC6.2/CC6.3, ISO 27001 A.5.18)."
        >
          <SectionBody className="space-y-6">
            {openReview ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{openReview.name}</h4>
                  <StatusPill tone="info" dot>
                    In progress
                  </StatusPill>
                  {openReview.dueAt && (
                    <span className="text-xs text-muted-foreground">
                      Due <Deadline value={openReview.dueAt} now={now} timeZone={timeZone} />
                    </span>
                  )}
                </div>
                <AccessReviewItems
                  reviewId={openReview.id}
                  currentUserId={access.userId}
                  canSelfCertify={await canSelfCertify(access.userId)}
                  canComplete={isAdmin}
                  items={openReview.items.map(item => ({
                    id: item.id,
                    userId: item.userId,
                    subjectType: item.subjectType,
                    subjectLabel: item.subjectLabel,
                    decision: item.decision,
                    note: item.note,
                  }))}
                />
              </div>
            ) : (
              <StartAccessReviewForm />
            )}
            {pastReviews.length > 0 && (
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Past reviews
                </h4>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {pastReviews.map(review => {
                    const status = REVIEW_STATUS.get(review.status) ?? {
                      label: review.status.toLowerCase(),
                      tone: 'neutral' as PillTone,
                    };
                    return (
                      <li
                        key={review.id}
                        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {review.name}
                            </span>
                            <StatusPill tone={status.tone}>{status.label}</StatusPill>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {review._count.items} item{review._count.items === 1 ? '' : 's'} ·
                            started {formatDateTime(review.createdAt, timeZone, { format: 'date' })}
                          </p>
                        </div>
                        <a
                          href={`/api/access/reviews/${review.id}/export`}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Evidence
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </SectionBody>
        </SettingsSection>
      </SectionAnchor>

      {isAdmin && (
        <SectionAnchor id="custom-roles">
          <SettingsSection
            title="Custom roles"
            description="Bundles of extra permissions for specific people, on top of their built-in role. For example, let an auditor run a runbook without making them a Responder."
          >
            <SectionBody>
              <CustomRolesManager
                roles={customRoles.map(role => ({
                  id: role.id,
                  name: role.name,
                  description: role.description,
                  capabilities: role.capabilities,
                  holders: role._count.users,
                }))}
                users={userOptions}
                assignments={users
                  .filter(user => user.customRoleId)
                  .map(user => ({ userId: user.id, customRoleId: user.customRoleId as string }))}
              />
            </SectionBody>
          </SettingsSection>
        </SectionAnchor>
      )}

      <SectionAnchor id="denials">
        <SettingsSection
          title="Most denied (last 7 days)"
          description="Pages and actions people were blocked from most often. Frequent denials usually mean someone needs a role, a team, or a custom role."
        >
          {insights.length === 0 ? (
            <ListEmpty
              icon={<ShieldBan className="h-5 w-5" aria-hidden="true" />}
              title="No access denials recorded"
            >
              When someone is blocked from a page or action, it shows here.
            </ListEmpty>
          ) : (
            <div className="-mx-4 md:-mx-6">
              <ResponsiveTable
                caption="Most denied pages and actions in the last 7 days"
                columns={[
                  { label: 'Page or action' },
                  { label: 'Needed' },
                  { label: 'People', className: 'text-right' },
                  { label: 'Times', className: 'text-right' },
                ]}
              >
                {insights.map(row => (
                  <ResponsiveRow key={row.path}>
                    <ResponsiveCell label="Page or action" primary>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                        {row.path}
                      </code>
                    </ResponsiveCell>
                    <ResponsiveCell label="Needed" className="text-xs text-muted-foreground">
                      {row.capabilities.filter(isCapability).length
                        ? describeRequirement(row.capabilities.filter(isCapability) as Capability[])
                            .rolesText
                        : 'Team or item access'}
                    </ResponsiveCell>
                    <ResponsiveCell label="People" align="end" className="tabular-nums">
                      {row.people}
                    </ResponsiveCell>
                    <ResponsiveCell label="Times" align="end" className="tabular-nums">
                      {row.count}
                    </ResponsiveCell>
                  </ResponsiveRow>
                ))}
              </ResponsiveTable>
            </div>
          )}
        </SettingsSection>
      </SectionAnchor>

      {isAdmin && (
        <SectionAnchor id="access-policy">
          <SettingsSection
            title="Access policy"
            description="Organization-wide rules for incident work, requests, emergency access and reviews. Changes require a recent sign-in and are audited."
          >
            <SectionBody>
              <AccessPolicyForm
                initial={{
                  userIncidentActionsEnabled: settings.userIncidentActionsEnabled,
                  requestsEnabled: settings.requestsEnabled,
                  breakGlassEnabled: settings.breakGlassEnabled,
                  breakGlassMaxMinutes: settings.breakGlassMaxMinutes,
                  selfApprovalAllowed: settings.selfApprovalAllowed,
                  reviewIntervalDays: settings.reviewIntervalDays,
                }}
              />
            </SectionBody>
          </SettingsSection>
        </SectionAnchor>
      )}

      <SectionAnchor id="built-in-roles">
        <SettingsSection
          title="Built-in roles"
          description="Generated from the rules OpsKnight enforces."
          action={
            <Link
              href="/settings/access"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View my access
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <SectionBody>
            <RoleMatrix />
          </SectionBody>
        </SettingsSection>
      </SectionAnchor>
    </div>
  );
}
