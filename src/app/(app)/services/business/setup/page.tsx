import { Boxes } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { PageHeader } from '@/components/patterns';
import SetupWizard from '@/components/business-service-setup/SetupWizard';
import ImportBusinessServicesButton from '@/components/business-service-import/ImportDialog';
import { loadBusinessServiceFormOptions } from '../form-options';

export default async function BusinessServiceSetupPage() {
  await requirePageAccess('/services/business/setup');
  const actor = await getCurrentAuthorizationActor();
  const canManagePages = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  }).allowed;
  const [options, statusPages] = await Promise.all([
    loadBusinessServiceFormOptions(actor),
    canManagePages
      ? prisma.statusPage.findMany({
          orderBy: { name: 'asc' },
          take: 200,
          select: { id: true, name: true, enabled: true },
        })
      : [],
  ]);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Service catalog"
        title="Set up a business service"
        icon={Boxes}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: 'Business services', href: '/services/business' },
          { label: 'Setup' },
        ]}
        description="Name it, pick the services behind it, set who owns it, where it shows and who hears about it."
        secondaryActions={<ImportBusinessServicesButton />}
      />
      <SetupWizard
        services={options.services}
        teams={options.teams}
        statusPages={statusPages.map(page => ({
          id: page.id,
          name: page.name,
          hint: page.enabled ? null : 'Disabled',
        }))}
      />
    </div>
  );
}
