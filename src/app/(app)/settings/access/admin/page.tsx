import { ShieldCheck } from 'lucide-react';

import prisma from '@/lib/prisma';
import { requirePageAccessSnapshot } from '@/lib/access/server';
import { getAccessControlSettings } from '@/lib/access/settings';
import { accessDenialInsights, listCustomRoles } from '@/lib/access/admin';
import { describeRequirement } from '@/lib/access/catalog';
import { isCapability, roleLabel, type AppRole, type Capability } from '@/lib/authorization';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
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

export default async function AccessManagementPage() {
  const access = await requirePageAccessSnapshot('/settings/access/admin');
  const isAdmin = access.capabilities.includes('admin.manage');
  const now = new Date();
  const [settings, users, customRoles, grants, openReview, pastReviews, insights, pendingRequests] =
    await Promise.all([
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
    ]);

  const userOptions = users.map(({ id, name, email, role }) => ({ id, name, email, role }));
  const breakGlassActive = grants.filter(grant => grant.source === 'BREAK_GLASS');

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
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Pending requests', value: pendingRequests, href: '/settings/access/requests' },
          { label: 'Temporary access', value: grants.length },
          {
            label: 'Emergency access now',
            value: breakGlassActive.length,
            alert: breakGlassActive.length > 0,
          },
          { label: 'Custom roles', value: customRoles.length },
        ].map(card => (
          <a
            key={card.label}
            href={card.href ?? '#'}
            className={`rounded-xl border p-4 ${card.alert ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'border-border bg-card'}`}
          >
            <div className="text-2xl font-bold">{card.value}</div>
            <div className="text-xs text-muted-foreground">{card.label}</div>
          </a>
        ))}
      </div>

      <SettingsSection
        title="Access checker"
        description="Pick a person and something they tried to do. See whether it is allowed and exactly why, using the same rules that enforce access."
      >
        <AccessChecker users={userOptions} />
      </SettingsSection>

      <SettingsSection
        title="Who has access"
        description="Everyone holding a permission through their role, a custom role, or temporary access."
      >
        <WhoHasAccess />
      </SettingsSection>

      <SettingsSection
        title="Temporary and emergency access"
        description="Access that ends automatically. End any of it early if it is no longer needed."
      >
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has temporary access right now.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {grants.map(grant => (
              <li key={grant.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex-1">
                  <strong>{grant.user.name ?? grant.user.email}</strong> ·{' '}
                  {grant.role
                    ? roleLabel(grant.role as AppRole)
                    : `${grant.teamRole?.toLowerCase()} of a team`}
                  {grant.incidentId ? ' (one incident)' : ''} until{' '}
                  {grant.expiresAt.toLocaleString()}
                  {grant.source === 'BREAK_GLASS' && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      Emergency
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">{grant.reason}</span>
                </span>
                {isAdmin && <EndGrantButton grantId={grant.id} label="End access" />}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Access reviews"
        description="Periodically confirm that everyone with elevated access still needs it. Completed reviews produce audit evidence (SOC 2 CC6.2/CC6.3, ISO 27001 A.5.18)."
      >
        <div className="space-y-5">
          {openReview ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                {openReview.name}
                {openReview.dueAt ? ` · due ${openReview.dueAt.toLocaleDateString()}` : ''}
              </h4>
              <AccessReviewItems
                reviewId={openReview.id}
                currentUserId={access.userId}
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
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Past reviews
              </h4>
              <ul className="text-sm">
                {pastReviews.map(review => (
                  <li key={review.id} className="flex flex-wrap gap-2 py-1">
                    <span className="flex-1">
                      {review.name} · {review.status.toLowerCase()} · {review._count.items} items
                    </span>
                    <a
                      href={`/api/access/reviews/${review.id}/export`}
                      className="text-primary hover:underline"
                    >
                      Evidence
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SettingsSection>

      {isAdmin && (
        <SettingsSection
          title="Custom roles"
          description="Bundles of extra permissions for specific people, on top of their built-in role. For example, let an auditor run a runbook without making them a Responder."
        >
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
        </SettingsSection>
      )}

      <SettingsSection
        title="Most denied (last 7 days)"
        description="Pages and actions people were blocked from most often. Frequent denials usually mean someone needs a role, a team, or a custom role."
      >
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">No access denials recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Page or action</th>
                <th className="py-1 font-medium">Needed</th>
                <th className="py-1 text-right font-medium">People</th>
                <th className="py-1 text-right font-medium">Times</th>
              </tr>
            </thead>
            <tbody>
              {insights.map(row => (
                <tr key={row.path} className="border-t border-border">
                  <td className="py-1.5 font-mono text-xs">{row.path}</td>
                  <td className="py-1.5 text-xs">
                    {row.capabilities.filter(isCapability).length
                      ? describeRequirement(row.capabilities.filter(isCapability) as Capability[])
                          .rolesText
                      : 'Team or item access'}
                  </td>
                  <td className="py-1.5 text-right">{row.people}</td>
                  <td className="py-1.5 text-right">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsSection>

      {isAdmin && (
        <SettingsSection
          title="Access policy"
          description="Organization-wide rules for incident work, requests, emergency access and reviews. Changes require a recent sign-in and are audited."
        >
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
        </SettingsSection>
      )}

      <SettingsSection
        title="Built-in roles"
        description="Generated from the rules OpsKnight enforces."
      >
        <RoleMatrix />
      </SettingsSection>
    </div>
  );
}
