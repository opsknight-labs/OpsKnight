import type { ReactNode } from 'react';

export type MobileNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  iconActive: ReactNode;
  hasBadge?: boolean;
};

export const MOBILE_MORE_ROUTES = [
  '/m/teams',
  '/m/users',
  '/m/schedules',
  '/m/policies',
  '/m/analytics',
  '/m/postmortems',
  '/m/status',
];

export const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  {
    href: '/m',
    label: 'Home',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        width="24"
        height="24"
      >
        <path d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5Z" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5Z" />
      </svg>
    ),
  },
  {
    href: '/m/incidents',
    label: 'Incidents',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        width="24"
        height="24"
      >
        <path d="M12 3 2.5 20h19L12 3Zm0 6 4.5 9h-9L12 9Zm0 3v4" strokeLinecap="round" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M12 2L1 21h22L12 2z" />
      </svg>
    ),
  },
  {
    href: '/m/services',
    label: 'Services',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        width="24"
        height="24"
      >
        <rect x="4" y="6" width="16" height="5" rx="1" />
        <rect x="4" y="13" width="16" height="5" rx="1" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M4 6h16v5H4V6Zm0 7h16v5H4v-5Z" />
      </svg>
    ),
  },
  {
    href: '/m/notifications',
    label: 'Alerts',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        width="24"
        height="24"
      >
        <path
          d="M12 4a6 6 0 0 0-6 6v3l-1.3 2.6a.5.5 0 0 0 .4.8h13.8a.5.5 0 0 0 .4-.8L18 13v-3a6 6 0 0 0-6-6Z"
          strokeLinecap="round"
        />
        <path d="M9 17v1a3 3 0 0 0 6 0v-1" strokeLinecap="round" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M18 10a6 6 0 1 0-12 0v3.586l-1.707 1.707A1 1 0 0 0 5 17h14a1 1 0 0 0 .707-1.707L18 13.586V10zM9 18a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1z" />
      </svg>
    ),
    hasBadge: true,
  },
  {
    href: '/m/more',
    label: 'More',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        width="24"
        height="24"
      >
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    ),
  },
];
