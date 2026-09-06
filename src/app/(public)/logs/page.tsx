import LogsClient from './LogsClient';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function PublicLogsPage() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        background:
          'radial-gradient(circle at top right, rgba(211,47,47,0.12), transparent 45%), radial-gradient(circle at bottom left, rgba(17,24,39,0.08), transparent 45%), #f8fafc',
      }}
    >
      <div
        className="glass-panel"
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: '2rem',
          background: 'white',
        }}
      >
        <header
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Live App Logs
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Real-time, temporary log view for quick troubleshooting. Available to administrators
            only.
          </p>
        </header>
        <LogsClient />
      </div>
    </main>
  );
}
