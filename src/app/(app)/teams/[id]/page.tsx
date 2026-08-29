import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import {
  addTeamMember,
  assignServicesToTeam,
  deleteTeam,
  designateTeamLead,
  removeTeamMember,
  updateTeam,
  updateTeamMemberNotifications,
  updateTeamMemberRole,
} from '../actions';
import TeamLeadBadge from '@/components/teams/TeamLeadBadge';
import TeamAvatarStack from '@/components/teams/TeamAvatarStack';
import TeamOwnedServicesGrid from '@/components/teams/TeamOwnedServicesGrid';
import TeamActivityTimeline from '@/components/teams/TeamActivityTimeline';
import TeamMemberRosterTable from '@/components/teams/TeamMemberRosterTable';
import TeamMemberAddModal from '@/components/teams/TeamMemberAddModal';
import TeamAssignServicesModal from '@/components/teams/TeamAssignServicesModal';
import TeamLinkedPolicies from '@/components/teams/TeamLinkedPolicies';
import TeamDetailTabs from '@/components/teams/TeamDetailTabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  ArrowLeft,
  Users,
  Shield,
  UserCheck,
  CheckCircle2,
  Crown,
  Activity,
  AlertTriangle,
  Network,
  Settings2,
} from 'lucide-react';
import EditTeamForm from './EditTeamForm';
import DeleteTeamCard from './DeleteTeamCard';

type TeamDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
};

export default async function TeamDetailPage({ params, searchParams }: TeamDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;

  const [team, users, allServices, auditLogs, permissions, activeIncidentsCount] =
    await Promise.all([
      prisma.team.findUnique({
        where: { id },
        include: {
          teamLead: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              gender: true,
            },
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  status: true,
                  avatarUrl: true,
                  gender: true,
                },
              },
            },
            orderBy: { role: 'asc' },
          },
          services: {
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
              policy: {
                select: {
                  id: true,
                  name: true,
                  _count: { select: { steps: true } },
                },
              },
            },
          },
          _count: {
            select: {
              members: true,
              services: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          avatarUrl: true,
          gender: true,
        },
        orderBy: { name: 'asc' },
        take: 100,
      }),
      prisma.service.findMany({
        select: {
          id: true,
          name: true,
          description: true,
          teamId: true,
          team: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'TEAM', entityId: id },
            { entityType: 'TEAM_MEMBER', entityId: { startsWith: `${id}:` } },
          ],
        },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              gender: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      getUserPermissions(),
      prisma.incident.count({
        where: {
          service: { teamId: id },
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
      }),
    ]);

  if (!team) {
    notFound();
  }

  const ownerCount = team.members.filter(m => m.role === 'OWNER').length;
  const isTeamOwner = team.members.some(m => m.userId === permissions.id && m.role === 'OWNER');
  const canUpdateTeam = permissions.isAdminOrResponder || isTeamOwner;
  const canDeleteTeam = permissions.isAdmin;
  const canManageMembers = permissions.isAdminOrResponder || isTeamOwner;
  const canManageNotifications =
    permissions.isAdmin ||
    isTeamOwner ||
    (permissions.isAdminOrResponder && team.members.some(m => m.userId === permissions.id));
  const canAssignOwnerAdmin = permissions.isAdmin || isTeamOwner;

  const existingMemberUserIds = new Set(team.members.map(m => m.userId));
  const availableUsers = users.filter(u => !existingMemberUserIds.has(u.id));

  // Available services not currently on this team
  const availableServicesToAssign = allServices.filter(s => s.teamId !== team.id);

  // Extract unique linked escalation policies
  const policyMap = new Map<string, { id: string; name: string; _count: { steps: number } }>();
  team.services.forEach(s => {
    if (s.policy) {
      policyMap.set(s.policy.id, s.policy);
    }
  });
  const linkedPolicies = Array.from(policyMap.values());

  // --- TAB 1: OVERVIEW ---
  const overview = (
    <div className="space-y-6">
      {/* 2-Column Hero: Left = Team Ownership & Lead, Right = Member Roster Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Team Lead & Mission */}
        <Card className="overflow-hidden border-border/70 shadow-xs">
          <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Crown className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-semibold">Team Leadership</CardTitle>
              </div>
              <TeamLeadBadge lead={team.teamLead} />
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Mission &amp; Scope</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {team.description || 'No description provided for this team.'}
              </p>
            </div>

            <div className="pt-2 border-t flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Team Lead role:</span>
              <span className="text-foreground font-medium">
                {team.teamLead ? 'Direct escalation recipient' : 'Unassigned'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Right: Member Snapshot & Quick Add */}
        <Card className="overflow-hidden border-border/70 shadow-xs">
          <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Users className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-semibold">
                  Member Roster ({team._count.members})
                </CardTitle>
              </div>
              <TeamMemberAddModal
                teamId={team.id}
                availableUsers={availableUsers}
                canManageMembers={canManageMembers}
                canAssignOwnerAdmin={canAssignOwnerAdmin}
                addMember={addTeamMember}
              />
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Responders:</span>
              <TeamAvatarStack members={team.members} maxVisible={6} size="md" />
            </div>

            <div className="pt-2 border-t flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Owners / Admins:</span>
              <span className="text-foreground font-semibold">
                {ownerCount} Owner{ownerCount === 1 ? '' : 's'} ·{' '}
                {team.members.filter(m => m.role === 'ADMIN').length} Admin
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Linked Escalation Policies & Blast Radius */}
      <Card className="overflow-hidden border-border/70 shadow-xs">
        <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                <Network className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Linked Escalation Policies</CardTitle>
                <CardDescription className="text-[11px]">
                  Policies routing incidents across this team's services
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" size="xs">
              {linkedPolicies.length} {linkedPolicies.length === 1 ? 'policy' : 'policies'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <TeamLinkedPolicies policies={linkedPolicies} />
        </CardContent>
      </Card>

      {/* Owned Services Grid */}
      <Card className="overflow-hidden border-border/70 shadow-xs">
        <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Owned Services</CardTitle>
                <CardDescription className="text-[11px]">
                  Microservices and infrastructure supported by this team
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" size="xs">
              {team._count.services} {team._count.services === 1 ? 'service' : 'services'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <TeamOwnedServicesGrid
            services={team.services}
            teamId={team.id}
            canManage={canUpdateTeam}
          />
        </CardContent>
      </Card>

      {/* Recent Activity Timeline Preview */}
      <Card className="overflow-hidden border-border/70 shadow-xs">
        <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Activity className="h-4 w-4" />
            </div>
            <CardTitle className="text-sm font-semibold">Recent Team Activity</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <TeamActivityTimeline logs={auditLogs.slice(0, 5)} />
        </CardContent>
      </Card>
    </div>
  );

  // --- TAB 2: MEMBERS ---
  const membersTab = (
    <Card className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Team Members &amp; Roles</CardTitle>
            <CardDescription className="text-xs">
              Configure member permissions, team lead role, and incident alert subscriptions
            </CardDescription>
          </div>
          <TeamMemberAddModal
            teamId={team.id}
            availableUsers={availableUsers}
            canManageMembers={canManageMembers}
            canAssignOwnerAdmin={canAssignOwnerAdmin}
            addMember={addTeamMember}
          />
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <TeamMemberRosterTable
          members={team.members}
          teamId={team.id}
          currentTeamLeadId={team.teamLeadId}
          ownerCount={ownerCount}
          canManageMembers={canManageMembers}
          canManageNotifications={canManageNotifications}
          canAssignOwnerAdmin={canAssignOwnerAdmin}
          updateMemberRole={updateTeamMemberRole}
          updateMemberNotifications={updateTeamMemberNotifications}
          removeMember={removeTeamMember}
          designateTeamLeadAction={designateTeamLead}
        />
      </CardContent>
    </Card>
  );

  // --- TAB 3: SERVICES ---
  const servicesTab = (
    <Card className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Owned Services Matrix</CardTitle>
            <CardDescription className="text-xs">
              Services assigned to this team for triage, maintenance, and incident alerting
            </CardDescription>
          </div>
          {canUpdateTeam && (
            <TeamAssignServicesModal
              teamId={team.id}
              teamName={team.name}
              availableServices={availableServicesToAssign}
              canManage={canUpdateTeam}
              assignServicesAction={assignServicesToTeam}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <TeamOwnedServicesGrid
          services={team.services}
          teamId={team.id}
          canManage={canUpdateTeam}
        />
      </CardContent>
    </Card>
  );

  // --- TAB 4: ACTIVITY ---
  const activityTab = (
    <Card className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Team Audit Trail</CardTitle>
            <CardDescription className="text-xs">
              Complete history of membership, leadership, and configuration updates
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <TeamActivityTimeline logs={auditLogs} />
      </CardContent>
    </Card>
  );

  // --- TAB 5: SETTINGS ---
  const settingsTab = (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/70 shadow-xs">
        <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Team Details</CardTitle>
              <CardDescription className="text-xs">
                Update team name, mission description, and team lead assignment
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <EditTeamForm
            team={team}
            members={team.members}
            canUpdate={canUpdateTeam}
            updateTeamAction={updateTeam}
          />
        </CardContent>
      </Card>

      {canDeleteTeam && (
        <DeleteTeamCard teamId={team.id} teamName={team.name} deleteTeamAction={deleteTeam} />
      )}
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Header with Breadcrumbs & Hero Banner */}
      <header className="space-y-4">
        <Link
          href="/teams"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Teams</span>
          <span className="opacity-40">/</span>
          <span className="font-medium text-foreground">{team.name}</span>
        </Link>

        {/* Hero Banner with Glassmorphic Stats Capsule */}
        <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary to-primary/80 p-4 text-primary-foreground shadow-lg md:p-6">
          <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary-foreground/[0.08] blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
                <Users className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">
                    Team Workspace
                  </p>
                  {team.teamLead && (
                    <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      Lead: {team.teamLead.name}
                    </span>
                  )}
                </div>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-primary-foreground md:text-3xl">
                  {team.name}
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-primary-foreground/85">
                  {team.description || 'No mission description defined.'}
                </p>
              </div>
            </div>

            {/* Glassmorphic Stats Capsule with Active Incidents */}
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-1.5 backdrop-blur-sm lg:min-w-[330px]">
              <div className="min-w-0 rounded-md px-3 py-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Members
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
                  <UserCheck className="h-3.5 w-3.5" /> {team._count.members}
                </p>
              </div>
              <div className="min-w-0 rounded-md border-x border-primary-foreground/20 px-3 py-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Services
                </p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
                  <Shield className="h-3.5 w-3.5" /> {team._count.services}
                </p>
              </div>
              <div className="min-w-0 rounded-md px-3 py-2 text-center">
                <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                  Incidents
                </p>
                <p
                  className={`mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold ${
                    activeIncidentsCount > 0 ? 'text-amber-200' : 'text-emerald-100'
                  }`}
                >
                  {activeIncidentsCount > 0 ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" /> {activeIncidentsCount} Active
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> 0 Active
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Controlled Tabs */}
      <TeamDetailTabs
        defaultTab={query?.tab}
        overview={overview}
        members={membersTab}
        services={servicesTab}
        activity={activityTab}
        settings={settingsTab}
        memberCount={team._count.members}
        serviceCount={team._count.services}
      />
    </main>
  );
}
