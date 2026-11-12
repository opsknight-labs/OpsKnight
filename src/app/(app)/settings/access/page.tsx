import Link from 'next/link';
import { KeyRound, Mail } from 'lucide-react';

import prisma from '@/lib/prisma';
import { getViewableTeamWhere } from '@/lib/rbac';
import { requirePageAccessSnapshot, findGrantors } from '@/lib/access/server';
import { groupCapabilities } from '@/lib/access/catalog';
import { listMyAccessRequests, describeAccessRequest } from '@/lib/access/requests';
import { ROLE_DESCRIPTIONS, roleLabel, type Capability } from '@/lib/authorization';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Badge } from '@/components/ui/shadcn/badge';
import RoleMatrix from '@/components/access/RoleMatrix';
import RequestAccessForm from '@/components/access/RequestAccessForm';
import BreakGlassButton from '@/components/access/BreakGlassButton';
import { CancelRequestButton, EndGrantButton } from '@/components/access/AccessControls';

export const dynamic = 'force-dynamic';

const TEAM_ROLE_HELP: Record<string, string> = {
  OWNER: 'Manage members, owners, settings and services',
  ADMIN: 'Manage members, settings and services (not owners)',
  MEMBER: 'Work this team’s incidents and see its services',
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  DENIED: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200',
  CANCELLED: 'bg-muted text-muted-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
};

function formatDate(value: Date | string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function MyAccessPage() {
  const access = await requirePageAccessSnapshot('/settings/access');
  const [requests, grantors, otherTeams] = await Promise.all([
    listMyAccessRequests(access.userId),
    findGrantors({ grantor: 'org_admin' }),
    // Only teams this person may already see (the whole directory for Responders, Auditors and
    // Admins; nothing extra for Users, who request team access from the Access denied page).
    prisma.team.findMany({
      where: {
        AND: [await getViewableTeamWhere(), { members: { none: { userId: access.userId } } }],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
  ]);
  const groups = groupCapabilities(access.capabilities as Capability[]);
  const isOperator = access.capabilities.includes('operations.manage');

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        tag="Account & Identity"
        title="My access"
        subtitle="What you can see and do in OpsKnight, why, and how to get more."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <KeyRound className="h-8 w-8" />
          </div>
        }
        badges={
          <Badge
            variant="outline"
            className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
          >
            {roleLabel(access.role)}
            {access.customRole ? ` + ${access.customRole.name}` : ''}
          </Badge>
        }
      />

      <SettingsSection
        title={`Your role: ${roleLabel(access.baseRole)}`}
        description={ROLE_DESCRIPTIONS.get(access.baseRole)}
      >
        <div className="space-y-3 text-sm">
          {access.roleSource !== 'MANUAL' && (
            <p className="text-muted-foreground">
              Your role is managed by your identity provider ({access.roleSource}). To change it,
              ask your IT team to update your group membership.
            </p>
          )}
          {access.customRole && (
            <p>
              You also have the <strong>{access.customRole.name}</strong> custom role, which adds
              the extra permissions listed below.
            </p>
          )}
          {access.grants.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold">Temporary access</h4>
              <ul className="space-y-2">
                {access.grants.map(grant => (
                  <li
                    key={grant.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <span className="flex-1">
                      {grant.role ? <strong>{roleLabel(grant.role)}</strong> : 'Team access'}
                      {grant.incidentId ? ' for one incident' : ''} until{' '}
                      {formatDate(grant.expiresAt)}
                      {grant.source === 'BREAK_GLASS' ? ' · emergency access' : ''}
                      <span className="block text-xs text-muted-foreground">{grant.reason}</span>
                    </span>
                    <EndGrantButton grantId={grant.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Your teams"
        description="Team membership controls which services and incidents you see and can work on."
      >
        {access.teams.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {access.teams.map(team => (
              <li key={team.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link href={`/teams/${team.id}`} className="font-medium hover:underline">
                  {team.name}
                </Link>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {team.role.toLowerCase()}
                </Badge>
                <span className="text-xs text-muted-foreground">{TEAM_ROLE_HELP[team.role]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            You are not in any team yet, so you only see incidents assigned to you or that you
            watch. Ask to join a team below.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="What you can do"
        description="Everything your role, custom role and temporary access allow, in plain language."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map(group => (
            <div key={group.group}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h4>
              <ul className="space-y-0.5 text-sm">
                {group.items.map(item => (
                  <li key={item.capability}>{item.info.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SettingsSection>

      {access.settings.requestsEnabled && (
        <SettingsSection
          title="Request more access"
          description="Ask for a different role or to join a team. Approvers are notified, and you can ask for access that ends automatically."
        >
          <RequestAccessForm
            originPath="/settings/access"
            currentRole={access.role}
            teamChoices={otherTeams.length > 0 ? otherTeams : undefined}
            canRequestOrgRole={access.roleSource === 'MANUAL'}
          />
        </SettingsSection>
      )}

      {requests.length > 0 && (
        <SettingsSection title="Your requests">
          <ul className="divide-y divide-border text-sm">
            {requests.map(request => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[request.status]}`}
                >
                  {request.status.toLowerCase()}
                </span>
                <span className="flex-1">
                  {describeAccessRequest(request)}
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(request.createdAt)}
                    {request.decisionNote ? ` · “${request.decisionNote}”` : ''}
                  </span>
                </span>
                {request.status === 'PENDING' && <CancelRequestButton requestId={request.id} />}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {access.settings.breakGlassEnabled && !isOperator && (
        <SettingsSection
          title="Emergency access"
          description={`During an incident that can’t wait for approval, give yourself Responder access for up to ${access.settings.breakGlassMaxMinutes} minutes. Administrators are alerted immediately and every action is audited.`}
        >
          <BreakGlassButton
            maxMinutes={access.settings.breakGlassMaxMinutes}
            returnPath="/settings/access"
          />
        </SettingsSection>
      )}

      <SettingsSection title="Compare roles" description="What each built-in role can do.">
        <RoleMatrix current={access.baseRole} />
      </SettingsSection>

      <SettingsSection title="Who can help" description="Organization administrators.">
        <ul className="flex flex-wrap gap-2">
          {grantors.people.map(person => (
            <li key={person.id}>
              <a
                href={`mailto:${person.email}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
              >
                <Mail className="h-3 w-3" aria-hidden />
                {person.name ?? person.email}
              </a>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </div>
  );
}
