'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, CircleAlert, CircleCheck, Plus, TriangleAlert } from 'lucide-react';
import MobileQuickSwitcher from '@/components/mobile/MobileQuickSwitcher';

const LIST_TITLES: Record<string, string> = {
  '/m/incidents': 'Incidents',
  '/m/services': 'Services',
  '/m/notifications': 'Alerts',
  '/m/schedules': 'On-call',
  '/m/teams': 'Teams',
  '/m/users': 'Users',
  '/m/policies': 'Policies',
  '/m/analytics': 'Analytics',
  '/m/postmortems': 'Postmortems',
  '/m/status': 'System health',
  '/m/more': 'More',
};

const DETAIL_ROUTES = [
  { prefix: '/m/incidents/', title: 'Incident', backHref: '/m/incidents' },
  { prefix: '/m/services/', title: 'Service', backHref: '/m/services' },
  { prefix: '/m/schedules/', title: 'Schedule', backHref: '/m/schedules' },
  { prefix: '/m/teams/', title: 'Team', backHref: '/m/teams' },
  { prefix: '/m/users/', title: 'User', backHref: '/m/users' },
  { prefix: '/m/policies/', title: 'Policy', backHref: '/m/policies' },
  { prefix: '/m/postmortems/', title: 'Postmortem', backHref: '/m/postmortems' },
] as const;

type MobileHeaderProps = {
  systemStatus?: 'ok' | 'warning' | 'danger';
};

function routeContext(pathname: string) {
  if (pathname === '/m') return { home: true, title: 'OpsKnight' } as const;
  if (pathname === '/m/incidents/create') {
    return { home: false, title: 'New incident', backHref: '/m/incidents' } as const;
  }
  const detail = DETAIL_ROUTES.find(route => pathname.startsWith(route.prefix));
  if (detail) return { home: false, title: detail.title, backHref: detail.backHref } as const;
  return { home: false, title: LIST_TITLES[pathname] || 'OpsKnight' } as const;
}

export default function MobileHeader({ systemStatus = 'ok' }: MobileHeaderProps) {
  const pathname = usePathname() || '/m';
  const route = routeContext(pathname);
  const status =
    systemStatus === 'danger'
      ? { label: 'Critical issues', Icon: CircleAlert }
      : systemStatus === 'warning'
        ? { label: 'Degraded performance', Icon: TriangleAlert }
        : { label: 'All systems operational', Icon: CircleCheck };
  const StatusIcon = status.Icon;

  return (
    <header className="mobile-header">
      <div className="mobile-header-primary">
        {route.home ? (
          <Link href="/m" className="mobile-header-brand" aria-label="OpsKnight home">
            <img src="/logo.svg" alt="" width={28} height={28} aria-hidden="true" />
            <span>OpsKnight</span>
          </Link>
        ) : route.backHref ? (
          <>
            <Link
              href={route.backHref}
              className="mobile-header-icon-button"
              aria-label={`Back to ${route.backHref.split('/').pop() || 'previous page'}`}
            >
              <ArrowLeft aria-hidden="true" />
            </Link>
            <span className="mobile-header-page-title">{route.title}</span>
          </>
        ) : (
          <span className="mobile-header-page-title">{route.title}</span>
        )}
      </div>

      <div className="mobile-header-actions">
        {pathname === '/m/incidents' && (
          <Link href="/m/incidents/create" className="mobile-header-icon-button" aria-label="Create incident">
            <Plus aria-hidden="true" />
          </Link>
        )}
        <MobileQuickSwitcher />
        <Link
          href="/m/status"
          className="mobile-header-system-button"
          data-status={systemStatus}
          aria-label={`System status: ${status.label}`}
          title={status.label}
        >
          <StatusIcon aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
