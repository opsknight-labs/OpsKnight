export type AppSurface = 'desktop' | 'mobile';

function root(surface: AppSurface) {
  return surface === 'mobile' ? '/m' : '';
}

function idSegment(id: string) {
  return encodeURIComponent(id);
}

export const appRoutes = {
  home: (surface: AppSurface) => root(surface) || '/',
  incidents: (surface: AppSurface) => `${root(surface)}/incidents`,
  incident: (surface: AppSurface, id: string) => `${root(surface)}/incidents/${idSegment(id)}`,
  createIncident: (surface: AppSurface) => `${root(surface)}/incidents/create`,
  services: (surface: AppSurface) => `${root(surface)}/services`,
  service: (surface: AppSurface, id: string) => `${root(surface)}/services/${idSegment(id)}`,
  teams: (surface: AppSurface) => `${root(surface)}/teams`,
  team: (surface: AppSurface, id: string) => `${root(surface)}/teams/${idSegment(id)}`,
  users: (surface: AppSurface) => `${root(surface)}/users`,
  user: (surface: AppSurface, id: string) => `${root(surface)}/users/${idSegment(id)}`,
  policies: (surface: AppSurface) => `${root(surface)}/policies`,
  policy: (surface: AppSurface, id: string) => `${root(surface)}/policies/${idSegment(id)}`,
  schedules: (surface: AppSurface) => `${root(surface)}/schedules`,
  schedule: (surface: AppSurface, id: string) => `${root(surface)}/schedules/${idSegment(id)}`,
  analytics: (surface: AppSurface, incidentId?: string) => {
    const base = `${root(surface)}/analytics`;
    return incidentId ? `${base}?incident=${idSegment(incidentId)}` : base;
  },
  notifications: (surface: AppSurface) =>
    surface === 'mobile' ? '/m/notifications' : '/notifications',
  postmortems: (surface: AppSurface) => `${root(surface)}/postmortems`,
  postmortem: (surface: AppSurface, id: string) => `${root(surface)}/postmortems/${idSegment(id)}`,
  login: (surface: AppSurface = 'desktop', callbackUrl?: string) => {
    const base = surface === 'mobile' ? '/m/login' : '/login';
    return callbackUrl ? `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}` : base;
  },
} as const;

export const SUPPORTED_MOBILE_ROUTE_PREFIXES = [
  '/incidents',
  '/services',
  '/teams',
  '/users',
  '/policies',
  '/schedules',
  '/analytics',
  '/notifications',
  '/postmortems',
  '/help',
  '/more',
  '/status',
] as const;

/**
 * Returns the mobile equivalent route if one exists in OpsKnight, or null if
 * the route is desktop-only (e.g. /settings/**).
 */
export function toMobilePath(pathname: string): string | null {
  if (pathname === '/') return '/m';
  if (pathname === '/login') return '/m/login';
  if (pathname === '/forgot-password') return '/m/forgot-password';
  if (
    SUPPORTED_MOBILE_ROUTE_PREFIXES.some(
      prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return `/m${pathname}`;
  }
  return null;
}

export type ResponderRouteTarget =
  | { kind: 'home' }
  | { kind: 'incident'; id: string }
  | { kind: 'login'; callbackUrl?: string }
  | { kind: 'notifications' }
  | { kind: 'dashboard' };

export function responderRoute(surface: AppSurface, target: ResponderRouteTarget): string {
  switch (target.kind) {
    case 'home':
    case 'dashboard':
      return appRoutes.home(surface);
    case 'incident':
      return appRoutes.incident(surface, target.id);
    case 'login':
      return appRoutes.login(surface, target.callbackUrl);
    case 'notifications':
      return appRoutes.notifications(surface);
  }
}
