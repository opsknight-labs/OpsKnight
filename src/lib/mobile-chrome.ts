export const FOCUSED_WORKFLOW_ROOTS = new Set([
  'incidents',
  'services',
  'schedules',
  'teams',
  'users',
  'policies',
  'postmortems',
]);

/**
 * Returns true if the pathname is an interior/focused workflow
 * (e.g. /m/incidents/create, /m/incidents/:id, /m/services/:id)
 * where the global bottom navigation should be suppressed to maximize
 * operational focus and screen geometry.
 */
export function isFocusedMobileWorkflow(pathname: string): boolean {
  if (!pathname) return false;
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3 && segments[0] === 'm' && FOCUSED_WORKFLOW_ROOTS.has(segments[1]);
}
