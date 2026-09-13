import { Suspense } from 'react';
import { createMobileIncident, getIncidentCreationContext } from '@/app/(app)/incidents/actions';
import { Card } from '@/components/ui/shadcn/card';
import MobileCreateIncidentClient from './client';

export const dynamic = 'force-dynamic';

export default async function MobileCreateIncidentPage() {
  const context = await getIncidentCreationContext();

  if (!context.canCreateIncident) {
    return (
      <div className="responsive-page py-2">
        <Card
          className="rounded-2xl border-amber-300/70 bg-amber-50 p-4 text-amber-950 shadow-none dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          <p className="text-sm font-semibold">Incident creation is unavailable.</p>
          <p className="mt-1 text-xs leading-relaxed opacity-80">
            You don&apos;t have access to create incidents for any service.
          </p>
        </Card>
      </div>
    );
  }

  const services = context.services.map(service => ({
    id: service.id,
    name: service.name,
    defaultIncidentVisibility: service.defaultIncidentVisibility,
  }));
  const users = context.users.map(user => ({ id: user.id, name: user.name, email: user.email }));
  const templates = context.templates.map(template => ({
    id: template.id,
    name: template.name,
    description: template.description,
    title: template.title,
    descriptionText: template.descriptionText,
    defaultUrgency: template.defaultUrgency,
    defaultPriority: template.defaultPriority,
    defaultService: template.defaultService
      ? { id: template.defaultService.id, name: template.defaultService.name }
      : null,
  }));

  return (
    <div className="responsive-page py-2 pb-12">
      <Suspense
        fallback={
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card p-6 text-xs text-muted-foreground">
            Loading incident template…
          </div>
        }
      >
        <MobileCreateIncidentClient
          services={services}
          users={users}
          templates={templates}
          createAction={createMobileIncident}
        />
      </Suspense>
    </div>
  );
}
