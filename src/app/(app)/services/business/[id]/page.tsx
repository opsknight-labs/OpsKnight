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
import BusinessServiceStatusPill from '@/components/service/BusinessServiceStatusPill';
import { getBusinessServiceHealth } from '@/lib/business-services/contract';
import { loadBusinessServiceFormOptions } from '../form-options';

export default async function EditBusinessServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageAccess('/services/business/[id]');
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
  const [options, health] = await Promise.all([
    loadBusinessServiceFormOptions(actor, {
      serviceIds: item.members.map(member => member.service.id),
      userIds: item.followers.map(follower => follower.user.id),
    }),
    getBusinessServiceHealth([item.id], actor),
  ]);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Service catalog"
        title={item.name}
        icon={Boxes}
        badges={<BusinessServiceStatusPill status={health.get(item.id)?.status ?? 'OPERATIONAL'} />}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: 'Business services', href: '/services/business' },
          { label: item.name },
        ]}
        description="Changes apply to status pages that show this business service on their next publish."
      />
      <BusinessServiceForm
        services={options.services}
        teams={options.teams}
        users={options.users}
        canDelete={permissions.isAdmin}
        initial={{
          id: item.id,
          name: item.name,
          description: item.description ?? '',
          tier: item.tier ?? '',
          ownerTeamId: item.ownerTeamId ?? '',
          memberServiceIds: item.members.map(member => member.service.id),
          followerUserIds: item.followers.map(follower => follower.user.id),
        }}
      />
    </div>
  );
}
