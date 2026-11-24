import type { Metadata } from 'next';
import { Boxes } from 'lucide-react';
import { requirePageAccess } from '@/lib/access/server';
import { teamReadWhere } from '@/lib/authorization-filters';
import { listBusinessServiceTemplates } from '@/lib/business-services/templates';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { PageHeader } from '@/components/patterns';
import TemplateManager from '@/components/business-service/TemplateManager';

export const metadata: Metadata = { title: 'Business service templates' };
export const dynamic = 'force-dynamic';

export default async function BusinessServiceTemplatesPage() {
  await requirePageAccess('/services/business/templates');
  const actor = await getCurrentAuthorizationActor();
  const [templates, teams] = await Promise.all([
    listBusinessServiceTemplates(actor),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Service catalog"
        title="Business service templates"
        icon={Boxes}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: 'Business services', href: '/services/business' },
          { label: 'Templates' },
        ]}
        description="Reusable defaults for criticality, SLO, tags and ownership. Pick one when creating a business service."
      />
      <TemplateManager
        teams={teams}
        templates={templates.map(template => ({
          id: template.id,
          name: template.name,
          description: template.description,
          criticality: template.criticality,
          sloTarget: template.sloTarget,
          sloWindowDays: template.sloWindowDays,
          tags: template.tags,
          environment: template.environment,
          lifecycle: template.lifecycle,
          ownerTeamId: template.ownerTeamId,
          ownerTeamName: template.ownerTeam?.name ?? null,
        }))}
      />
    </div>
  );
}
