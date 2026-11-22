import { notFound } from 'next/navigation';
import { Boxes } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import {
  BUSINESS_SERVICE_SELECT,
  businessServiceReadWhere,
} from '@/lib/business-services/commands';
import { PageHeader } from '@/components/patterns';
import BusinessServiceForm from '@/components/service/BusinessServiceForm';
import HealthBadge from '@/components/business-service/HealthBadge';
import { getBusinessServiceHealth } from '@/lib/business-services/contract';
import { loadBusinessServiceFormOptions } from '../../form-options';

export default async function EditBusinessServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageAccess('/services/business/[id]/edit');
  const { id } = await params;
  const [permissions, actor] = await Promise.all([
    getUserPermissions(),
    getCurrentAuthorizationActor(),
  ]);
  const item = await prisma.businessService.findFirst({
    where: { AND: [{ id }, businessServiceReadWhere(actor)] },
    select: BUSINESS_SERVICE_SELECT,
  });
  if (!item) notFound();
  const dependsOn = item.supportedBy.map(({ child }) => ({ ...child, hint: null }));
  const [options, health] = await Promise.all([
    loadBusinessServiceFormOptions(actor, {
      serviceIds: item.members.map(member => member.service.id),
      userIds: item.followers.map(follower => follower.user.id),
      businessServiceId: item.id,
      dependsOn,
    }),
    getBusinessServiceHealth([item.id], actor),
  ]);
  const status = health.get(item.id);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Service catalog"
        title={`Edit ${item.name}`}
        icon={Boxes}
        badges={status ? <HealthBadge status={status.status} variant="solid" /> : undefined}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: 'Business services', href: '/services/business' },
          { label: item.name, href: `/services/business/${item.id}` },
          { label: 'Edit' },
        ]}
        description="Changes apply to status pages that show this business service on their next publish."
      />
      <BusinessServiceForm
        services={options.services}
        teams={options.teams}
        users={options.users}
        businessServices={options.businessServices}
        canDelete={permissions.isAdmin}
        initial={{
          id: item.id,
          name: item.name,
          description: item.description ?? '',
          tier: item.tier ?? '',
          ownerTeamId: item.ownerTeamId ?? '',
          memberServiceIds: item.members.map(member => member.service.id),
          followerUserIds: item.followers.map(follower => follower.user.id),
          criticality: item.criticality ?? '',
          impactMinUrgency: item.impactMinUrgency ?? '',
          impactMaxPriority: item.impactMaxPriority ?? '',
          nonCriticalServiceIds: item.members
            .filter(member => !member.critical)
            .map(member => member.service.id),
          dependsOnBusinessServiceIds: dependsOn.map(child => child.id),
        }}
      />
    </div>
  );
}
