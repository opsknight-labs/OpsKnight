'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  MinusCircle,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import MobileHeaderAction from '@/components/mobile/MobileHeaderAction';
import MobileQuickSwitcher from '@/components/mobile/MobileQuickSwitcher';
import ConnectionIndicator from '@/components/layout/ConnectionIndicator';

function getListTitle(pathname: string): string {
  switch (pathname) {
    case '/m/incidents':
      return 'Incidents';
    case '/m/services':
      return 'Services';
    case '/m/notifications':
      return 'Alerts';
    case '/m/schedules':
      return 'On-call';
    case '/m/teams':
      return 'Teams';
    case '/m/users':
      return 'Users';
    case '/m/policies':
      return 'Policies';
    case '/m/analytics':
      return 'Analytics';
    case '/m/postmortems':
      return 'Postmortems';
    case '/m/status':
      return 'System health';
    case '/m/more':
      return 'More';
    case '/m/help':
      return 'Help';
    default:
      return 'OpsKnight';
  }
}

const DETAIL_ROUTES = [
  { prefix: '/m/incidents/', title: 'Incident', backHref: '/m/incidents', backLabel: 'Incidents' },
  { prefix: '/m/services/', title: 'Service', backHref: '/m/services', backLabel: 'Services' },
  { prefix: '/m/schedules/', title: 'Schedule', backHref: '/m/schedules', backLabel: 'On-call' },
  { prefix: '/m/teams/', title: 'Team', backHref: '/m/teams', backLabel: 'Teams' },
  { prefix: '/m/users/', title: 'User', backHref: '/m/users', backLabel: 'Users' },
  { prefix: '/m/policies/', title: 'Policy', backHref: '/m/policies', backLabel: 'Policies' },
  {
    prefix: '/m/postmortems/',
    title: 'Postmortem',
    backHref: '/m/postmortems',
    backLabel: 'Postmortems',
  },
] as const;

const SERVICE_AUTOMATION_ROUTE = /^\/m\/services\/([^/]+)\/automation\/?$/;

type MobileHeaderProps = {
  systemStatus?: 'neutral' | 'ok' | 'warning' | 'danger';
  canCreateIncident?: boolean;
};

type RouteContext =
  | { home: true; title: string }
  | {
      home: false;
      title: string;
      backHref?: string;
      backLabel?: string;
      /** The app-bar title is the page heading (the page renders no h1 of its own). */
      isPageHeading?: boolean;
    };

function routeContext(pathname: string): RouteContext {
  if (pathname === '/m') return { home: true, title: 'OpsKnight' };
  if (pathname === '/m/incidents/create') {
    return {
      home: false,
      title: 'New incident',
      backHref: '/m/incidents',
      backLabel: 'Incidents',
      isPageHeading: true,
    };
  }
  const automation = SERVICE_AUTOMATION_ROUTE.exec(pathname);
  if (automation) {
    return {
      home: false,
      title: 'Automation',
      backHref: `/m/services/${automation[1]}`,
      backLabel: 'Service',
    };
  }
  const detail = DETAIL_ROUTES.find(route => pathname.startsWith(route.prefix));
  if (detail) {
    return {
      home: false,
      title: detail.title,
      backHref: detail.backHref,
      backLabel: detail.backLabel,
    };
  }
  return { home: false, title: getListTitle(pathname) };
}

export default function MobileHeader({
  systemStatus = 'neutral',
  canCreateIncident = false,
}: MobileHeaderProps) {
  const pathname = usePathname() || '/m';
  const route = routeContext(pathname);
  const status =
    systemStatus === 'neutral'
      ? { label: 'No operational scope', Icon: MinusCircle }
      : systemStatus === 'danger'
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
            <Image src="/logo.svg" alt="" width={28} height={28} aria-hidden="true" priority />
            <span>OpsKnight</span>
          </Link>
        ) : route.backHref ? (
          <>
            <MobileHeaderAction
              href={route.backHref}
              icon={<ArrowLeft className="h-5 w-5" aria-hidden="true" />}
              label={`Back to ${route.backLabel ?? 'previous page'}`}
            />
            {route.isPageHeading ? (
              <h1 className="mobile-header-page-title">{route.title}</h1>
            ) : (
              <span className="mobile-header-page-title">{route.title}</span>
            )}
          </>
        ) : (
          <h1 className="mobile-header-page-title">{route.title}</h1>
        )}
      </div>

      <div className="mobile-header-actions">
        <ConnectionIndicator variant="mobile" />
        {pathname === '/m/incidents' && canCreateIncident && (
          <MobileHeaderAction
            href="/m/incidents/create"
            icon={<Plus className="h-5 w-5" aria-hidden="true" />}
            label="Create incident"
          />
        )}
        <MobileQuickSwitcher />
        <MobileHeaderAction
          href="/m/status"
          icon={<StatusIcon className="h-5 w-5" aria-hidden="true" />}
          label={`System status: ${status.label}`}
          title={status.label}
          tone={systemStatus}
        />
      </div>
    </header>
  );
}
