/**
 * Routes outside the themed product surface keep a fixed light appearance:
 * public status pages carry their own per-page branding (and OS-driven dark
 * styles), and pre-sign-in desktop pages stay neutral. The authenticated
 * console, the mobile app (including /m/login) and the wallboard follow the
 * user's appearance preference.
 */
export const LIGHT_PINNED_PREFIXES = [
  '/status',
  '/status-auth',
  '/logs',
  '/oauth',
  '/login',
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/recovery',
  '/auth',
  '/clear-desktop-preference',
] as const;

export function isLightPinnedRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return LIGHT_PINNED_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
