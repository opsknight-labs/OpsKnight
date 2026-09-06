import prisma from '@/lib/prisma';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { ShieldAlert, Server, Layers, HelpCircle, ArrowRight, Calendar, Users } from 'lucide-react';
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
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/policies');
  }
  await getCurrentUser();
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
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Header */}
      <DetailHeroBanner
        tag="Incident Response Routing"
        title="Escalation Policies"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Define multi-tier responder routing, failover delays, and notification cadences when
            critical incidents occur across your services.
          </p>
        }
        stats={[
          {
            label: 'Total Policies',
            value: totalPolicies,
            icon: <ShieldAlert className="h-3.5 w-3.5" />,
          },
          {
            label: 'In Use',
            value: inUsePoliciesCount,
            icon: <Server className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: inUsePoliciesCount > 0 ? 'text-emerald-200' : undefined,
          },
          {
            label: 'Total Steps',
            value: totalStepsCount,
            icon: <Layers className="h-3.5 w-3.5" />,
          },
        ]}
        alert={
          errorCode === 'duplicate-policy' ? (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium">
              An escalation policy with this name already exists. Please choose a unique name.
            </div>
          ) : undefined
        }
      />

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
