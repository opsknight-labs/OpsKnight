import Link from 'next/link';
import CreateIncidentFormModern from '@/components/incident/CreateIncidentFormModern';
import { getIncidentCreationContext } from '../actions';

export default async function CreateIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const params = await searchParams;
  const templateId = params.template || null;
  const context = await getIncidentCreationContext();

  if (!context.canCreateIncident) {
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
                ⚠️ You don't have access to create incidents for any service.
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
              Incident creation is disabled for your current permissions. Contact an administrator
              if you need access.
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
        templates={context.templates as any}
        services={context.services}
        users={context.users}
        selectedTemplateId={templateId}
        customFields={context.customFields}
        teams={context.teams}
      />
    </main>
  );
}
