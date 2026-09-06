import prisma from '@/lib/prisma';
import Link from 'next/link';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import TemplateCreateForm from '@/components/incident/TemplateCreateForm';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { createTemplateAction } from '../../template-actions';
import { Button } from '@/components/ui/shadcn/button';
import { LayoutTemplate, ArrowLeft, AlertCircle } from 'lucide-react';

export default async function CreateTemplatePage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const permissions = await getUserPermissions();
  const canManageTemplates = permissions.isResponderOrAbove;

  if (!canManageTemplates) {
    redirect('/incidents/templates');
  }

  const services = await prisma.service.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams?.error;

  return (
    <main className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Unified Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Templates',
          href: '/incidents/templates',
          current: 'New Template',
        }}
        tag="Configuration"
        title="Create Incident Template"
        subtitle="Configure reusable defaults for common outage scenarios to dispatch responders with zero lag."
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-white border border-zinc-700/80 shadow-xs">
            <LayoutTemplate className="h-6 w-6 text-rose-500" />
          </div>
        }
        actions={
          <Link href="/incidents/templates">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Templates
            </Button>
          </Link>
        }
      />

      {errorCode === 'duplicate-template' && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive shadow-2xs animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold">Template Name Conflict</h4>
            <p className="text-xs opacity-90 mt-0.5">
              An incident template with this name already exists. Please choose a unique name.
            </p>
          </div>
        </div>
      )}

      <TemplateCreateForm services={services} action={createTemplateAction} />
    </main>
  );
}
