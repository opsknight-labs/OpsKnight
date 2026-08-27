import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { getAllTemplates } from '../template-actions';
import Link from 'next/link';
import CreateIncidentFormModern from '@/components/incident/CreateIncidentFormModern';

export default async function CreateIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const params = await searchParams;
  const templateId = params.template || null;

  const [services, users, permissions, customFields, teams] = await Promise.all([
    prisma.service.findMany({ orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    }),
    getUserPermissions(),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const templates = await getAllTemplates(permissions.id);

  const canCreateIncident = permissions.capabilities.some(
    capability => capability === 'incident.create.all' || capability === 'incident.create.scoped'
  );

  if (!canCreateIncident) {
    return (
      <main>
        <Link
          href="/incidents"
          style={{
            color: 'var(--text-muted)',
            marginBottom: '2rem',
            display: 'inline-block',
            textDecoration: 'none',
          }}
        >
          ← Back to Incidents
        </Link>

        <div
          className="glass-panel"
          style={{
            padding: '2.5rem',
            maxWidth: '980px',
            margin: '0 auto',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '1.5rem',
              marginBottom: '2rem',
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: '2rem',
                  fontWeight: '800',
                  marginBottom: '0.35rem',
                  color: 'var(--text-secondary)',
                }}
              >
                Create Incident
              </h1>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                ⚠️ You don't have access to create incidents. Responder role or above required.
              </p>
            </div>
            <Link href="/incidents" className="glass-button" style={{ textDecoration: 'none' }}>
              Back to Incidents
            </Link>
          </div>
          <div
            style={{
              padding: '2rem',
              background: 'white',
              borderRadius: '0px',
              opacity: 0.5,
              pointerEvents: 'none',
            }}
          >
            <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Incident creation form is disabled. Please contact an administrator to upgrade your
              role.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8">
      <div className="mb-8">
        <Link
          href="/incidents"
          className="text-muted-foreground hover:text-foreground transition-colors mb-4 inline-flex items-center gap-2 text-sm font-medium"
        >
          ← Back to Incidents
        </Link>

        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight tracking-tight text-foreground sm:text-4xl mb-2">
              Create Incident
            </h1>
            <p className="text-lg text-muted-foreground">
              Log a new incident and trigger response workflows.
            </p>
          </div>
          <Link
            href="/incidents/templates"
            className="hidden sm:inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
          >
            Use Template
          </Link>
        </div>
      </div>

      <CreateIncidentFormModern
        templates={templates as any}
        services={services}
        users={users}
        selectedTemplateId={templateId}
        customFields={customFields}
        teams={teams}
      />
    </main>
  );
}
