import prisma from '@/lib/prisma';
import { getUserPermissions, getViewableTeamWhere } from '@/lib/rbac';
import { createTeam } from './actions';
import TeamDirectoryList from '@/components/teams/TeamDirectoryList';
import TeamStatsCapsule from '@/components/teams/TeamStatsCapsule';
import TeamCreateForm from '@/components/TeamCreateForm';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Users, Shield, ArrowUpRight, Sparkles, UserCheck } from 'lucide-react';

export default async function TeamsPage() {
  const teamScope = await getViewableTeamWhere();
  const teams = await prisma.team.findMany({
    where: teamScope,
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
        },
      },
      _count: {
        select: {
          members: true,
          services: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const totalTeams = teams.length;
  const uniqueMembers = new Set(teams.flatMap(t => t.members.map(m => m.userId))).size;
  const uniqueServices = new Set(teams.flatMap(t => t.services.map(s => s.id))).size;
  const configuredTeamsCount = teams.filter(t => t.members.length > 0 && t.teamLead).length;

  const permissions = await getUserPermissions();
  const canCreateTeam = permissions.isAdminOrResponder;

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      {/* Header Banner with Glassmorphic Stats Capsule */}
      <div className="relative overflow-hidden rounded-xl border border-slate-800/90 bg-[#0b1120] p-4 text-slate-100 shadow-xl ring-1 ring-white/5 md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-800/80 text-white border border-slate-700/80 shadow-xs">
              <Users className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Organization &amp; Ownership
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                Teams
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-300">
                Manage team ownership, lead assignments, responder rosters, and service coverage.
              </p>
            </div>
          </div>

          <TeamStatsCapsule
            totalTeams={totalTeams}
            totalMembers={uniqueMembers}
            totalServices={uniqueServices}
            configuredCount={configuredTeamsCount}
          />
        </div>
      </div>

      {/* Top Action: Create Team Dashed Expander */}
      <TeamCreateForm action={createTeam} canCreate={canCreateTeam} />

      {/* Main Grid: Directory + Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Teams Directory List */}
        <div className="xl:col-span-3 space-y-4">
          <TeamDirectoryList teams={teams} />
        </div>

        {/* Sidebar: Guide & Quick Links */}
        <aside className="space-y-4">
          {/* Team Lifecycle & Best Practices Guide */}
          <Card className="overflow-hidden border-border/70 shadow-xs">
            <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Sparkles className="h-3 w-3" />
                </div>
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Team Lifecycle
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  1
                </span>
                <div>
                  <p className="font-semibold text-foreground">Assign Team Lead</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Designate an owner/lead to receive targeted escalation notifications.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  2
                </span>
                <div>
                  <p className="font-semibold text-foreground">Build Responder Roster</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Add engineers with explicit roles (Owner, Admin, Member) and channel
                    preferences.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  3
                </span>
                <div>
                  <p className="font-semibold text-foreground">Connect Owned Services</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Link microservices and applications to automatically route incident alerts.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card className="overflow-hidden border-border/70 shadow-xs">
            <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Quick Links
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-between h-8 text-xs font-medium"
              >
                <Link href="/users">
                  <span className="flex items-center gap-2">
                    <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    All Responders
                  </span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-between h-8 text-xs font-medium"
              >
                <Link href="/services">
                  <span className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    Service Catalog
                  </span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
