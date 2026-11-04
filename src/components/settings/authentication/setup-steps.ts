import type { AuthenticationSection } from '@/lib/auth-control/dashboard';

/**
 * The single source of truth for what each part of the authentication console is called.
 * Tabs, the progress bar, blocker links and the docs all use these names, so they can never
 * drift apart again.
 */
export const AUTH_TAB_LABELS: Record<AuthenticationSection, string> = {
  overview: 'Overview',
  connection: '1 · Connect provider',
  access: '2 · Who can sign in',
  roles: '3 · Roles & teams',
  policy: '4 · Test & activate',
  emergency: 'Emergency recovery',
  diagnostics: 'Diagnostics',
};

/** Short names used inside sentences, for example "Go to Who can sign in". */
export const AUTH_TAB_NAMES: Record<AuthenticationSection, string> = {
  overview: 'Overview',
  connection: 'Connect provider',
  access: 'Who can sign in',
  roles: 'Roles & teams',
  policy: 'Test & activate',
  emergency: 'Emergency recovery',
  diagnostics: 'Diagnostics',
};

export const SETUP_TABS: AuthenticationSection[] = ['connection', 'access', 'roles', 'policy'];

export const IDENTITY_GUIDE = 'https://opsknight.com/docs/latest/guides/identity';
export const authDocs = {
  configure: `${IDENTITY_GUIDE}/configure-oidc/`,
  roles: `${IDENTITY_GUIDE}/map-roles-and-teams/`,
  linking: `${IDENTITY_GUIDE}/link-existing-accounts/`,
  modes: `${IDENTITY_GUIDE}/authentication-modes/`,
  emergency: `${IDENTITY_GUIDE}/configure-emergency-access/`,
  scim: `${IDENTITY_GUIDE}/configure-scim/`,
};
