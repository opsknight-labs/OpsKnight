import prisma from '@/lib/prisma';
import {
  assertCanListPolicies,
  getCurrentAuthorizationActor,
  getUserPermissions,
} from '@/lib/rbac';
import { countOpenInsightsForScopes } from '@/lib/intelligence/ops-insights/view';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { ShieldAlert, Server, Layers } from 'lucide-react';
import PolicyCreateForm from '@/components/policies/PolicyCreateForm';
import PolicyDirectoryList from '@/components/policies/PolicyDirectoryList';
import { createPolicyAction } from './actions';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import type { PolicyDirectoryItem } from '@/components/policies/PolicyDirectoryCard';

import { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/access/server';

export const revalidate = 0;

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string;
    page?: string;
    q?: string;
    search?: string;
    status?: string;
  }>;
}) {
  await requirePageAccess('/policies');
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/policies');
  }
  await assertCanListPolicies();

  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;
  const requestedPage = parsePageParam(resolvedSearchParams?.page);
  const searchQuery = (resolvedSearchParams?.q || resolvedSearchParams?.search || '').trim();
  const statusFilter = resolvedSearchParams?.status || 'all';

  const filterConditions: Prisma.EscalationPolicyWhereInput[] = [];

  if (searchQuery) {
    filterConditions.push({
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' } },
        { description: { contains: searchQuery, mode: 'insensitive' } },
        { services: { some: { name: { contains: searchQuery, mode: 'insensitive' } } } },
      ],
    });
  }

  if (statusFilter === 'in-use') {
    filterConditions.push({ services: { some: {} } });
  } else if (statusFilter === 'unassigned') {
    filterConditions.push({ services: { none: {} } });
  } else if (statusFilter === 'needs-setup') {
    filterConditions.push({ steps: { none: {} } });
  }

  const where: Prisma.EscalationPolicyWhereInput =
    filterConditions.length > 0 ? { AND: filterConditions } : {};

  const [
    allPoliciesCount,
    inUsePoliciesCount,
    unassignedPoliciesCount,
    needsSetupPoliciesCount,
    totalStepsCount,
    totalFilteredCount,
    permissions,
  ] = await Promise.all([
    prisma.escalationPolicy.count(),
    prisma.escalationPolicy.count({ where: { services: { some: {} } } }),
    prisma.escalationPolicy.count({ where: { services: { none: {} } } }),
    prisma.escalationPolicy.count({ where: { steps: { none: {} } } }),
    prisma.escalationRule.count(),
    prisma.escalationPolicy.count({ where }),
    getUserPermissions(),
  ]);

  const pagination = calculatePaginationBounds({
    totalItems: totalFilteredCount,
    page: requestedPage,
    pageSize: 50,
  });

  const policies = await prisma.escalationPolicy.findMany({
    where,
    skip: pagination.skip,
    take: pagination.take,
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
  });

  const canManagePolicies = permissions.isAdmin;
  // One grouped read for the page's rows; empty while escalation insights are off. Never a model call.
  const insightCounts = await countOpenInsightsForScopes(
    await getCurrentAuthorizationActor(),
    'POLICY',
    policies.map(policy => policy.id)
  ).catch(() => new Map<string, never>());

  // Aggregated stats
  const totalPolicies = allPoliciesCount;

  // Transform policies into directory items
  const policyDirectoryItems: PolicyDirectoryItem[] = policies.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    updatedAt: p.updatedAt,
    stepCount: p.steps.length,
    serviceCount: p.services.length,
    services: p.services,
    insights: insightCounts.get(p.id) ?? null,
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
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-xs font-medium dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300">
              An escalation policy with this name already exists. Please choose a unique name.
            </div>
          ) : undefined
        }
      />

      {/* Interactive Dashed Expander Create Policy Form */}
      {canManagePolicies && (
        <PolicyCreateForm action={createPolicyAction} canCreate={canManagePolicies} />
      )}

      {/* Policy directory (full width; the old guide rail lives in its header popover) */}
      <PolicyDirectoryList
        policies={policyDirectoryItems}
        pagination={{
          currentPage: pagination.page,
          totalPages: pagination.totalPages,
          totalItems: pagination.totalItems,
          itemsPerPage: pagination.pageSize,
        }}
        filterCounts={{
          total: allPoliciesCount,
          inUse: inUsePoliciesCount,
          unassigned: unassignedPoliciesCount,
          needsSetup: needsSetupPoliciesCount,
        }}
        currentSearch={searchQuery}
        currentStatus={statusFilter}
      />
    </div>
  );
}
