import prisma from '@/lib/prisma';
import { assertAdmin, getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { ShieldAlert, Server, ArrowRight, HelpCircle, Users, Calendar } from 'lucide-react';
import PolicyCreateForm from '@/components/policies/PolicyCreateForm';
import PolicyDirectoryList from '@/components/policies/PolicyDirectoryList';
import { createPolicyAction } from './actions';
import type { PolicyDirectoryItem } from '@/components/policies/PolicyDirectoryCard';

export const revalidate = 0;

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }
  const [policies, permissions] = await Promise.all([
    prisma.escalationPolicy.findMany({
      include: {
        steps: {
          include: {
            targetUser: { select: { id: true, name: true } },
            targetTeam: { select: { id: true, name: true } },
            targetSchedule: { select: { id: true, name: true } },
          },
          orderBy: { stepOrder: 'asc' },
        },
        services: {
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    getUserPermissions(),
  ]);

  const canManagePolicies = permissions.isAdmin;
  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;

  // Compute aggregated stats
  const totalPolicies = policies.length;
  const inUsePoliciesCount = policies.filter(p => p.services.length > 0).length;
  const totalStepsCount = policies.reduce((acc, p) => acc + p.steps.length, 0);

  // Transform policies into directory items
  const policyDirectoryItems: PolicyDirectoryItem[] = policies.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    stepCount: p.steps.length,
    serviceCount: p.services.length,
    services: p.services,
    steps: p.steps.map(s => ({
      id: s.id,
      stepOrder: s.stepOrder,
      delayMinutes: s.delayMinutes,
      targetType: s.targetType,
      targetUser: s.targetUser,
      targetTeam: s.targetTeam,
      targetSchedule: s.targetSchedule,
    })),
  }));

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Centralized Hero Header with 3-Stat Capsule */}
      <div className="bg-gradient-to-r from-primary via-primary/95 to-primary/80 text-white rounded-2xl p-6 sm:p-7 shadow-lg relative overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-white/5 pointer-events-none blur-2xl" />
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/15 text-white/90 backdrop-blur-xs border border-white/20">
                Incident Response Routing
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5 text-white">
              <ShieldAlert className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 text-white/90" />
              Escalation Policies
            </h1>
            <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
              Define multi-tier responder routing, failover delays, and notification cadences when
              critical incidents occur across your services.
            </p>
          </div>

          {/* 3-Stat Capsule */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5 w-full lg:w-auto shrink-0">
            <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
              <CardContent className="p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-black tracking-tight">{totalPolicies}</div>
                <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                  Total Policies
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
              <CardContent className="p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-black tracking-tight text-emerald-200">
                  {inUsePoliciesCount}
                </div>
                <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                  In Use (Services)
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
              <CardContent className="p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-black tracking-tight text-blue-200">
                  {totalStepsCount}
                </div>
                <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                  Total Steps
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {errorCode === 'duplicate-policy' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium">
          An escalation policy with this name already exists. Please choose a unique name.
        </div>
      )}

      {/* Interactive Dashed Expander Create Policy Form */}
      {canManagePolicies && (
        <PolicyCreateForm action={createPolicyAction} canCreate={canManagePolicies} />
      )}

      {/* Main Grid: Policy Directory & Sidebar Helper */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left 3 Cols: Policy Directory List */}
        <div className="lg:col-span-3 space-y-4">
          <PolicyDirectoryList policies={policyDirectoryItems} canManage={canManagePolicies} />
        </div>

        {/* Right 1 Col: Quick Links & Documentation */}
        <div className="space-y-4">
          {/* Quick Guide */}
          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <HelpCircle className="h-3.5 w-3.5 text-primary" />
                Escalation Best Practices
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
              <p>
                <strong className="text-foreground font-semibold">Tier 1:</strong> Start with
                on-call schedules or primary on-call responders with a 0m initial delay.
              </p>
              <p>
                <strong className="text-foreground font-semibold">Tier 2:</strong> Escalate to
                backup engineers or team leads after 5–10 minutes if unacknowledged.
              </p>
              <p>
                <strong className="text-foreground font-semibold">Tier 3:</strong> Route to entire
                escalation teams or engineering directors after 15–30 minutes for critical outages.
              </p>
            </CardContent>
          </Card>

          {/* Quick Navigation Links */}
          <Card className="border-slate-200/80 bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Connected Resources
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href="/services"
                className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors text-xs font-medium text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-slate-500" />
                  Services Directory
                </span>
                <ArrowRight className="h-3 w-3 text-slate-400" />
              </Link>

              <Link
                href="/schedules"
                className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors text-xs font-medium text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-slate-500" />
                  On-Call Schedules
                </span>
                <ArrowRight className="h-3 w-3 text-slate-400" />
              </Link>

              <Link
                href="/teams"
                className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors text-xs font-medium text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-slate-500" />
                  Teams & Members
                </span>
                <ArrowRight className="h-3 w-3 text-slate-400" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
