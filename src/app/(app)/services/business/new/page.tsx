import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { PageHeader } from '@/components/patterns';
import BusinessServiceForm from '@/components/service/BusinessServiceForm';
import { formValueFromTemplate } from '@/components/service/business-service-form-defaults';
import { linksToLines } from '@/lib/business-services/links';
import { listBusinessServiceTemplates } from '@/lib/business-services/templates';
import { loadBusinessServiceFormOptions } from '../form-options';

export default async function NewBusinessServicePage({
  searchParams,
}: {
  searchParams?: Promise<{ template?: string }>;
}) {
  await requirePageAccess('/services/business/new');
  const actor = await getCurrentAuthorizationActor();
  const [options, templates, query] = await Promise.all([
    loadBusinessServiceFormOptions(actor),
    listBusinessServiceTemplates(actor),
    searchParams,
  ]);
  const template = templates.find(item => item.id === query?.template);
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
      {templates.length > 0 && (
        <nav aria-label="Start from a template" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Start from</span>
          <Link
            href="/services/business/new"
            aria-current={template ? undefined : 'true'}
            className="rounded-full border px-3 py-1 hover:bg-muted aria-[current=true]:bg-muted aria-[current=true]:font-medium"
          >
            Blank
          </Link>
          {templates.map(item => (
            <Link
              key={item.id}
              href={`/services/business/new?template=${item.id}`}
              aria-current={item.id === template?.id ? 'true' : undefined}
              className="rounded-full border px-3 py-1 hover:bg-muted aria-[current=true]:bg-muted aria-[current=true]:font-medium"
            >
              {item.name}
            </Link>
          ))}
        </nav>
      )}
      <BusinessServiceForm
        // A new key remounts the form so picking another template replaces its initial values.
        key={template?.id ?? 'blank'}
        {...options}
        initial={
          template
            ? formValueFromTemplate({ ...template, linksText: linksToLines(template.links) })
            : undefined
        }
      />
    </div>
  );
}
