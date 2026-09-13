import type { ReactNode } from 'react';
import { Bell, CalendarClock, Ellipsis, Home, Siren } from 'lucide-react';

export type MobileNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  iconActive: ReactNode;
  hasBadge?: boolean;
};

function navIcon(Icon: typeof Home, active = false) {
  return <Icon aria-hidden="true" strokeWidth={active ? 2.5 : 2} />;
}

export const MOBILE_MORE_ROUTES = [
  '/m/services',
  '/m/teams',
  '/m/users',
  '/m/policies',
  '/m/analytics',
  '/m/postmortems',
  '/m/status',
  '/m/help',
];

export const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  {
    href: '/m',
    label: 'Home',
    icon: navIcon(Home),
    iconActive: navIcon(Home, true),
  },
  {
    href: '/m/incidents',
    label: 'Incidents',
    icon: navIcon(Siren),
    iconActive: navIcon(Siren, true),
  },
  {
    href: '/m/schedules',
    label: 'On-call',
    icon: navIcon(CalendarClock),
    iconActive: navIcon(CalendarClock, true),
  },
  {
    href: '/m/notifications',
    label: 'Alerts',
    icon: navIcon(Bell),
    iconActive: navIcon(Bell, true),
    hasBadge: true,
  },
  {
    href: '/m/more',
    label: 'More',
    icon: navIcon(Ellipsis),
    iconActive: navIcon(Ellipsis, true),
  },
];
