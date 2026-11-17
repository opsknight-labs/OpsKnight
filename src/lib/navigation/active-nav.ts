/**
 * Route matching for navigation highlights. Matching is by whole path segment, so `/runbooks`
 * covers `/runbooks` and `/runbooks/abc` but never `/runbooks-foo`.
 */

function normalizePath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] || '/';
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) return withoutQuery.slice(0, -1);
  return withoutQuery;
}

/** True when `pathname` is `href` itself or a route nested under it. */
export function matchesRouteSegment(pathname: string, href: string): boolean {
  const path = normalizePath(pathname);
  const target = normalizePath(href);
  if (target === '/') return path === '/';
  return path === target || path.startsWith(`${target}/`);
}

/**
 * The single nav href to highlight for `pathname`: the deepest href that matches by segment, so
 * nested routes light up only their closest item (`/incidents/templates` → `/incidents`, unless a
 * dedicated `/incidents/templates` item exists).
 */
export function getActiveNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!matchesRouteSegment(pathname, href)) continue;
    if (best === null || normalizePath(href).length > normalizePath(best).length) best = href;
  }
  return best;
}
