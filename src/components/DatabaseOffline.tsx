import { describeDatabaseTarget } from '@/lib/db-errors';

export default function DatabaseOffline({
  title = 'Database connection failed',
  errorMessage,
}: {
  title?: string;
  errorMessage?: string;
}) {
  const target = describeDatabaseTarget(process.env.DATABASE_URL);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--bg-primary, #f8fafc)',
        color: 'var(--text-primary, #111827)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '680px',
          background: 'var(--bg-secondary, #ffffff)',
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: '16px',
          padding: '1.5rem',
          boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'rgba(220,38,38,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            !
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>{title}</h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary, #4b5563)' }}>
              OpsKnight can’t reach the PostgreSQL database{target ? ` at ${target}` : ''}.
            </p>
          </div>
        </div>

        {errorMessage && (
          <pre
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              borderRadius: '12px',
              background: 'var(--bg-primary, #f8fafc)',
              border: '1px solid var(--border, #e5e7eb)',
              color: 'var(--text-secondary, #4b5563)',
              overflowX: 'auto',
              fontSize: '0.8rem',
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {errorMessage}
          </pre>
        )}

        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>How to fix</div>
          <ol
            style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary, #4b5563)' }}
          >
            <li style={{ marginBottom: '0.25rem' }}>
              Start Postgres: <code>docker compose up -d opsknight-db</code>
            </li>
            <li style={{ marginBottom: '0.25rem' }}>
              If you run <code>npm run dev</code> on your host machine, set{' '}
              <code>DATABASE_URL</code> host to <code>localhost</code> (not{' '}
              <code>opsknight-db</code>).
            </li>
            <li>
              Or run the app via Docker Compose (the in-network hostname <code>opsknight-db</code>{' '}
              works from inside containers).
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
