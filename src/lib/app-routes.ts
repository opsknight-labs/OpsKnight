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
  login: (callbackUrl?: string) =>
    callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/login',
} as const;
