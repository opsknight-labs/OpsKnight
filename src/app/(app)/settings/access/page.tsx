import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  Inbox,
  KeyRound,
  ShieldCheck,
  Siren,
  Users,
} from 'lucide-react';

import prisma from '@/lib/prisma';
import { requirePageAccessSnapshot, findGrantors } from '@/lib/access/server';
import { groupCapabilities } from '@/lib/access/catalog';
import {
  describeAccessRequest,
  effectiveAccessRequestStatus,
  listMyAccessRequests,
} from '@/lib/access/requests';
import { ROLE_DESCRIPTIONS, roleLabel, type Capability } from '@/lib/authorization';
import { getUserTimeZone } from '@/lib/timezone';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  ListEmpty,
  RelativeTime,
  ResponsiveCell,
  ResponsiveRow,
  ResponsiveTable,
  StatusPill,
} from '@/components/settings/mcp/McpListKit';
import {
  CapabilityGroupIcon,
  ContactChip,
  Fact,
  RequestStatusPill,
  SectionAnchor,
  SectionBody,
} from '@/components/access/AccessUi';
import RoleMatrix from '@/components/access/RoleMatrix';
import RequestAccessForm from '@/components/access/RequestAccessForm';
import BreakGlassButton from '@/components/access/BreakGlassButton';
import { CancelRequestButton, EndGrantButton } from '@/components/access/AccessControls';

export const dynamic = 'force-dynamic';

const TEAM_ROLE_HELP = new Map<string, string>([
  ['OWNER', 'Manage members, owners, settings and services'],
  ['ADMIN', 'Manage members, settings and services (not owners)'],
  ['MEMBER', 'Work this team’s incidents and see its services'],
]);

const ROLE_SOURCE_LABELS = new Map<string, string>([
  ['MANUAL', 'OpsKnight administrators'],
  ['OIDC', 'Your identity provider (SSO)'],
  ['SCIM', 'Your identity provider (SCIM)'],
]);

const heroBadgeClass =
  'bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider';

export default async function MyAccessPage() {
  const access = await requirePageAccessSnapshot('/settings/access');
  const now = new Date();
  const [requests, grantors, otherTeams, viewer] = await Promise.all([
    listMyAccessRequests(access.userId),
    findGrantors({ grantor: 'org_admin' }),
    // Team names only (no members, services or incidents), so anyone can ask to join the
    // team they need, including people who are not in any team yet.
    prisma.team.findMany({
      where: { members: { none: { userId: access.userId } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.user.findUnique({ where: { id: access.userId }, select: { timeZone: true } }),
  ]);
  const timeZone = getUserTimeZone(viewer ?? undefined);
  const groups = groupCapabilities(access.capabilities as Capability[]);
  const isOperator = access.capabilities.includes('operations.manage');
  const pendingCount = requests.filter(
    request => effectiveAccessRequestStatus(request, now) === 'PENDING'
  ).length;
  const managedExternally = access.roleSource !== 'MANUAL';

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
          <>
            <Badge variant="outline" className={heroBadgeClass}>
              {roleLabel(access.role)}
              {access.customRole ? ` + ${access.customRole.name}` : ''}
            </Badge>
            {managedExternally && (
              <Badge variant="outline" className={heroBadgeClass}>
                Managed by {access.roleSource}
              </Badge>
            )}
          </>
        }
        stats={[
          {
            label: 'Role',
            value: roleLabel(access.role),
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext: access.grants.length > 0 ? 'Includes temporary access' : 'Built-in role',
          },
          {
            label: 'Teams',
            value: `${access.teams.length}`,
            icon: <Users className="h-3.5 w-3.5" />,
            subtext: 'Memberships',
          },
          {
            label: 'Permissions',
            value: `${groups.reduce((total, group) => total + group.items.length, 0)}`,
            icon: <BadgeCheck className="h-3.5 w-3.5" />,
            subtext: 'In effect now',
          },
          {
            label: 'Requests',
            value: `${pendingCount}`,
            icon: <Inbox className="h-3.5 w-3.5" />,
            subtext: 'Waiting for approval',
            href: pendingCount > 0 ? '#your-requests' : undefined,
          },
        ]}
      />

      <SettingsSection
        title="How your access is set"
        description="Your built-in role sets the baseline. A custom role or temporary access can add to it."
      >
        <SectionBody className="space-y-5">
          <dl className="grid gap-5 sm:grid-cols-3">
            <Fact label="Built-in role">
              <span className="font-semibold">{roleLabel(access.baseRole)}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {ROLE_DESCRIPTIONS.get(access.baseRole)}
              </span>
            </Fact>
            <Fact label="Custom role">
              {access.customRole ? (
                <>
                  <span className="font-semibold">{access.customRole.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Adds the extra permissions listed below.
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </Fact>
            <Fact label="Managed by">
              <span className="font-semibold">{ROLE_SOURCE_LABELS.get(access.roleSource)}</span>
              {managedExternally && (
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  To change it permanently, ask your IT team to update your group membership.
                </span>
              )}
            </Fact>
          </dl>

          {access.grants.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Temporary access
              </h4>
              <ul className="space-y-2">
                {access.grants.map(grant => {
                  const emergency = grant.source === 'BREAK_GLASS';
                  return (
                    <li
                      key={grant.id}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {grant.role ? roleLabel(grant.role) : 'Team access'}
                            {grant.incidentId ? ' · one incident' : ''}
                          </span>
                          <StatusPill tone={emergency ? 'warning' : 'info'}>
                            {emergency ? 'Emergency' : 'Temporary'}
                          </StatusPill>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Ends{' '}
                          <RelativeTime
                            value={new Date(grant.expiresAt)}
                            now={now}
                            timeZone={timeZone}
                          />{' '}
                          · {grant.reason}
                        </p>
                      </div>
                      <EndGrantButton grantId={grant.id} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </SectionBody>
      </SettingsSection>

      <SettingsSection
        title="Your teams"
        description="Team membership controls which services and incidents you see and can work on."
      >
        {access.teams.length > 0 ? (
          <ul className="divide-y divide-border">
            {access.teams.map(team => (
              <li key={team.id} className="p-0">
                <Link
                  href={`/teams/${team.id}`}
                  className="group -mx-4 flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 md:-mx-6 md:px-6"
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                    <Users className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{team.name}</span>
                      <StatusPill tone={team.role === 'MEMBER' ? 'neutral' : 'violet'}>
                        {team.role.charAt(0) + team.role.slice(1).toLowerCase()}
                      </StatusPill>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {TEAM_ROLE_HELP.get(team.role)}
                    </span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ListEmpty
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
            title="You are not in any team yet"
            action={
              access.settings.requestsEnabled && otherTeams.length > 0 ? (
                <a
                  href="#request-access"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Ask to join a team
                </a>
              ) : undefined
            }
          >
            You only see incidents assigned to you or that you watch.
          </ListEmpty>
        )}
      </SettingsSection>

      <SettingsSection
        title="What you can do"
        description="Everything your role, custom role and temporary access allow, in plain language."
      >
        <SectionBody>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map(group => (
              <section
                key={group.group}
                aria-labelledby={`capability-group-${group.group}`}
                className="rounded-lg border border-border bg-muted/20 p-4"
              >
                <h4
                  id={`capability-group-${group.group}`}
                  className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <CapabilityGroupIcon group={group.group} className="h-3.5 w-3.5" />
                  </span>
                  {group.label}
                </h4>
                <ul className="space-y-2">
                  {group.items.map(item => (
                    <li
                      key={item.capability}
                      className="flex items-start gap-2 text-sm text-foreground"
                    >
                      <BadgeCheck
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      {item.info.label}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </SectionBody>
      </SettingsSection>

      {access.settings.requestsEnabled && (
        <SectionAnchor id="request-access">
          <SettingsSection
            title="Request more access"
            description="Ask for a different role or to join a team. Approvers are notified, and you can ask for access that ends automatically."
          >
            <SectionBody>
              <RequestAccessForm
                originPath="/settings/access"
                currentRole={access.role}
                teamChoices={otherTeams.length > 0 ? otherTeams : undefined}
                canRequestOrgRole={access.roleSource === 'MANUAL'}
              />
            </SectionBody>
          </SettingsSection>
        </SectionAnchor>
      )}

      {requests.length > 0 && (
        <SectionAnchor id="your-requests">
          <SettingsSection
            title="Your requests"
            description="Requests you sent and what happened to them."
          >
            <div className="-mx-4 md:-mx-6">
              <ResponsiveTable
                caption="Your access requests"
                columns={[
                  { label: 'Request' },
                  { label: 'Status' },
                  { label: 'Requested' },
                  { label: 'Outcome' },
                  { label: 'Actions', srOnly: true, className: 'text-right' },
                ]}
              >
                {requests.map(request => {
                  const status = effectiveAccessRequestStatus(request, now);
                  const decided =
                    request.decidedByName && (status === 'APPROVED' || status === 'DENIED');
                  return (
                    <ResponsiveRow key={request.id} muted={status !== 'PENDING'}>
                      <ResponsiveCell label="Request" primary>
                        <span className="font-medium text-foreground">
                          {describeAccessRequest(request)}
                        </span>
                      </ResponsiveCell>
                      <ResponsiveCell label="Status">
                        <RequestStatusPill status={status} />
                      </ResponsiveCell>
                      <ResponsiveCell label="Requested">
                        <RelativeTime value={request.createdAt} now={now} timeZone={timeZone} />
                      </ResponsiveCell>
                      <ResponsiveCell label="Outcome" className="text-xs text-muted-foreground">
                        {status === 'PENDING'
                          ? 'Waiting for an approver'
                          : decided
                            ? `${status === 'APPROVED' ? 'Approved' : 'Declined'} by ${request.decidedByName}`
                            : '—'}
                        {request.decisionNote && (
                          <span className="mt-0.5 block italic">“{request.decisionNote}”</span>
                        )}
                      </ResponsiveCell>
                      <ResponsiveCell label="Actions" primary align="end">
                        {status === 'PENDING' && <CancelRequestButton requestId={request.id} />}
                      </ResponsiveCell>
                    </ResponsiveRow>
                  );
                })}
              </ResponsiveTable>
            </div>
          </SettingsSection>
        </SectionAnchor>
      )}

      {access.settings.breakGlassEnabled && !isOperator && (
        <SettingsSection
          title="Emergency access"
          description="For incidents that can’t wait for an approver."
        >
          <SectionBody>
            <div className="flex flex-col gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20 sm:flex-row sm:items-center">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <Siren className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Give yourself Responder access for up to {access.settings.breakGlassMaxMinutes}{' '}
                  minutes
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Administrators are alerted immediately and every action is audited. It ends on its
                  own, or you can end it early.
                </p>
              </div>
              <BreakGlassButton
                maxMinutes={access.settings.breakGlassMaxMinutes}
                returnPath="/settings/access"
                size="default"
              />
            </div>
          </SectionBody>
        </SettingsSection>
      )}

      <SettingsSection title="Compare roles" description="What each built-in role can do.">
        <SectionBody>
          <RoleMatrix current={access.baseRole} />
        </SectionBody>
      </SettingsSection>

      <SettingsSection
        title="Who can help"
        description="Organization administrators can change roles, teams and custom roles."
      >
        <SectionBody>
          {grantors.people.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {grantors.people.map(person => (
                <li key={person.id} className="p-0">
                  <ContactChip name={person.name} email={person.email} subject="OpsKnight access" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" aria-hidden="true" />
              No administrator is available. Contact your OpsKnight owner.
            </p>
          )}
        </SectionBody>
      </SettingsSection>
    </div>
  );
}
