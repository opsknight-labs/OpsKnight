import { Boxes } from 'lucide-react';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { PageHeader } from '@/components/patterns';
import BusinessServiceForm from '@/components/service/BusinessServiceForm';
import { loadBusinessServiceFormOptions } from '../form-options';

export default async function NewBusinessServicePage() {
  await requirePageAccess('/services/business/new');
  const actor = await getCurrentAuthorizationActor();
  const options = await loadBusinessServiceFormOptions(actor);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Service catalog"
        title="New business service"
        icon={Boxes}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          { label: 'Business services', href: '/services/business' },
          { label: 'New' },
        ]}
        description="Name what customers rely on and pick the technical services behind it."
      />
      <BusinessServiceForm {...options} />
    </div>
  );
}
