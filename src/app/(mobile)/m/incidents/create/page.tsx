import { Suspense } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { getIncidentCreationContext } from '@/app/(app)/incidents/actions';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { MobileFormSkeleton } from '@/components/mobile/MobileSkeleton';
import MobileCreateIncidentClient from './client';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export default async function MobileCreateIncidentPage() {
  await requirePageAccess('/m/incidents/create');
  const context = await getIncidentCreationContext();

  if (!context.canCreateIncident) {
    return (
      <div className="responsive-page">
        <EmptyState
          icon={<Lock aria-hidden="true" />}
          title="You can't create incidents yet"
          description="Creating an incident needs responder access to at least one service. Ask an admin to add you to a team that owns a service."
          headingLevel="h2"
          action={
            <Button asChild variant="outline" size="lg" className="h-11 rounded-xl">
              <Link href="/m/incidents">Back to incidents</Link>
            </Button>
          }
        />
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
    <div className="responsive-page">
      <Suspense fallback={<MobileFormSkeleton label="Loading incident form" />}>
        <MobileCreateIncidentClient services={services} users={users} templates={templates} />
      </Suspense>
    </div>
  );
}
