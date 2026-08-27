import prisma from '@/lib/prisma';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import MobileTime from '@/components/mobile/MobileTime';
import NewIncidentButton from '@/components/mobile/NewIncidentButton';
import { formatDurationShort } from '@/lib/mobile-time';

export const dynamic = 'force-dynamic';

export default async function MobileDashboard() {
  const session = await getServerSession(await getAuthOptions());
  const userId = session?.user?.id;
  const lastUpdated = new Date();

  // Fetch key metrics and on-call status
  const metricsWindowDays = 90;
  const { calculateSLAMetrics } = await import('@/lib/sla-server');
  const slaMetrics = await calculateSLAMetrics({
    windowDays: metricsWindowDays,
    includeAllTime: false,
    includeActiveIncidents: true,
  });

  const dayMs = 24 * 60 * 60 * 1000;
  const effectiveWindowDays = Math.max(
    1,
    Math.ceil((slaMetrics.effectiveEnd.getTime() - slaMetrics.effectiveStart.getTime()) / dayMs)
  );
  const windowLabelDays = slaMetrics.isClipped ? effectiveWindowDays : metricsWindowDays;
  const windowLabelSuffix = slaMetrics.isClipped ? ' (retention limit)' : '';

  const currentOnCallShift = userId
    ? slaMetrics.currentShifts.find(s => s.userId === userId && s.end) || null
    : null;

  const openIncidents = slaMetrics.openCount;
  const criticalIncidents = slaMetrics.criticalCount;
  const resolved24h = slaMetrics.resolved24h;
  const totalActive = slaMetrics.openCount + slaMetrics.acknowledgedCount;

  const activeIncidentList = (slaMetrics.activeIncidentSummaries || [])
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map(incident => ({
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency,
      createdAt: incident.createdAt,
      service: { name: incident.serviceName },
    }));

  // Fetch user details for timezone
  const dbUser = session?.user?.email
    ? await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { timeZone: true, name: true },
      })
    : null;

  const userTimeZone = dbUser?.timeZone || 'UTC';
  const userName = dbUser?.name?.split(' ')[0] || session?.user?.name?.split(' ')[0] || 'there';

  // Get hour in user's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: userTimeZone,
  });
  const hour = parseInt(formatter.format(new Date()), 10);

  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mobile-dashboard">
      {/* Greeting */}
      <div style={{ marginBottom: '0.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0 }}>
          {greeting}, {userName}!
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
          Here&apos;s your incident overview
        </p>
      </div>

      {/* On-Call Widget */}
      {currentOnCallShift && (
        <Link
          href={`/m/schedules/${currentOnCallShift.scheduleId || currentOnCallShift.schedule.id || ''}`}
          className="mobile-enter delay-100"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.875rem 1rem',
            background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
            borderRadius: '12px',
            marginBottom: '1rem',
            textDecoration: 'none',
            color: 'white',
            boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.25rem',
            }}
          >
            📞
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>You&apos;re On-Call</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>
              {currentOnCallShift.schedule.name} • Until{' '}
              <MobileTime value={currentOnCallShift.end} format="shift-end" />
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      )}

      {/* Quick Actions */}
      <div className="mobile-quick-actions mobile-enter delay-200">
        <NewIncidentButton />
        <Link href="/m/incidents" className="mobile-quick-action secondary">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 3 2.5 20h19L12 3Zm0 6 4.5 9h-9L12 9Z" strokeLinecap="round" />
          </svg>
          View All
        </Link>
      </div>

      {/* Key Metrics */}
      <div className="mobile-metrics-grid mobile-enter delay-300">
        <div className="mobile-metric-card">
          <div className="mobile-metric-value">{openIncidents}</div>
          <div className="mobile-metric-label">Open</div>
        </div>
        <div className="mobile-metric-card" style={{ borderLeft: '3px solid #dc2626' }}>
          <div className="mobile-metric-value" style={{ color: '#dc2626' }}>
            {criticalIncidents}
          </div>
          <div className="mobile-metric-label">Critical</div>
        </div>
        <div className="mobile-metric-card" style={{ borderLeft: '3px solid #16a34a' }}>
          <div className="mobile-metric-value" style={{ color: '#16a34a' }}>
            {resolved24h}
          </div>
          <div className="mobile-metric-label">Resolved (24h)</div>
        </div>
        <div className="mobile-metric-card">
          <div className="mobile-metric-value">{totalActive}</div>
          <div className="mobile-metric-label">Total Active</div>
        </div>
      </div>
      <p className="text-[11px] font-medium text-[color:var(--text-muted)] mobile-enter delay-300">
        <strong>Triggered</strong>: New and unacknowledged. <strong>Total Active</strong>: Triggered
        plus acknowledged incidents; snoozed and suppressed incidents are excluded.
      </p>
      <p className="text-[11px] text-[color:var(--text-muted)] mobile-enter delay-300">
        Last updated <MobileTime value={lastUpdated} format="time" />
      </p>

      {/* Recent Incidents */}
      <div style={{ marginTop: '1.5rem' }} className="mobile-enter delay-400">
        <div className="mobile-section-header">
          <h2 className="mobile-section-title">Recent Incidents</h2>
          <Link href="/m/incidents" className="mobile-section-link">
            See all →
          </Link>
        </div>

        <div className="mobile-incident-list">
          {activeIncidentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-primary)] py-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100/50 dark:bg-emerald-900/20">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <path d="M22 4L12 14.01l-3-3" />
                  </svg>
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[color:var(--text-primary)]">All Clear!</h3>
                <p className="text-xs text-[color:var(--text-muted)]">
                  No active incidents right now.
                </p>
              </div>
            </div>
          ) : (
            activeIncidentList.map(incident => {
              const serviceName = incident.service?.name ?? 'Unknown service';
              return (
                <Link
                  key={incident.id}
                  href={`/m/incidents/${incident.id}`}
                  className="mobile-incident-card"
                >
                  <div className="mobile-incident-header">
                    <span className={`mobile-incident-status ${incident.status.toLowerCase()}`}>
                      {incident.status}
                    </span>
                    {incident.urgency && (
                      <span className={`mobile-incident-urgency ${incident.urgency.toLowerCase()}`}>
                        {incident.urgency}
                      </span>
                    )}
                    {/* Duration Timer */}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                    >
                      ⏱️ {formatDurationShort(incident.createdAt)}
                    </span>
                  </div>
                  <div className="mobile-incident-title">{incident.title}</div>
                  <div className="mobile-incident-meta">
                    <span>{serviceName}</span>
                    <span>•</span>
                    <MobileTime value={incident.createdAt} format="relative-short" />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Desktop Version Link */}
      <Link href="/api/prefer-desktop" className="mobile-desktop-link">
        Switch to Desktop Version
      </Link>
    </div>
  );
}
