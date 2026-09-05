import Link from 'next/link';
import { getUserPermissions } from '@/lib/rbac';
import { getAllTemplates } from '../template-actions';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import TemplatesListClient from '@/components/incident/TemplatesListClient';
import { Button } from '@/components/ui/shadcn/button';
import { LayoutTemplate, Plus } from 'lucide-react';

export const revalidate = 0;

export default async function TemplatesPage() {
  const permissions = await getUserPermissions();
  const canManageTemplates = permissions.isResponderOrAbove;

  const templates = await getAllTemplates(permissions.id);

  const totalCount = templates.length;
  const highUrgencyCount = templates.filter(t => t.defaultUrgency === 'HIGH').length;
  const publicCount = templates.filter(t => t.isPublic).length;
  const servicesCount = new Set(templates.map(t => t.defaultServiceId).filter(Boolean)).size;

  return (
    <main className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-5">
      {/* Unified Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Incidents',
          href: '/incidents',
          current: 'Templates',
        }}
        tag="Standard Operating Procedures"
        title="Incident Templates"
        subtitle="Standardize incident triage with pre-configured titles, severities, runbooks, and service routing."
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-white border border-zinc-700/80 shadow-xs">
            <LayoutTemplate className="h-6 w-6 text-rose-500" aria-hidden="true" />
          </div>
        }
        stats={[
          { label: 'Total', value: totalCount },
          {
            label: 'High Urgency',
            value: highUrgencyCount,
            valueClassName: 'text-rose-400',
          },
          {
            label: 'Public SOPs',
            value: publicCount,
            valueClassName: 'text-emerald-400',
          },
          {
            label: 'Services Linked',
            value: servicesCount,
          },
        ]}
        actions={
          canManageTemplates && (
            <Link href="/incidents/templates/create">
              <Button className="bg-white hover:bg-zinc-100 text-zinc-900 font-semibold shadow-xs transition-all cursor-pointer">
                <Plus className="w-4 h-4 mr-1.5" />
                Create Template
              </Button>
            </Link>
          )
        }
      />

      {/* Interactive Templates List with Search & Filtering */}
      <TemplatesListClient
        templates={templates}
        currentUserId={permissions.id}
        canManageTemplates={canManageTemplates}
      />
    </main>
  );
}
