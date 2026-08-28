import {
  createMobileIncident,
  getIncidentCreationContext,
} from '@/app/(app)/incidents/actions';
import MobileCreateIncidentClient from './client';

export const dynamic = 'force-dynamic';

export default async function MobileCreateIncidentPage() {
  const context = await getIncidentCreationContext();

  if (!context.canCreateIncident) {
    return (
      <div className="flex flex-col gap-4 p-4 pb-24">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
            New Incident
          </h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            You don't have access to create incidents for any service.
          </p>
        </div>
      </div>
    );
  }

  const services = context.services.map(service => ({ id: service.id, name: service.name }));
  const users = context.users.map(user => ({ id: user.id, name: user.name, email: user.email }));

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          New Incident
        </h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          Report a new issue
        </p>
      </div>

      <MobileCreateIncidentClient
        services={services}
        users={users}
        createAction={createMobileIncident}
      />
    </div>
  );
}
