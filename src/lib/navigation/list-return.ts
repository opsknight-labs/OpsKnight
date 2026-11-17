/**
 * Remembers each list page's last query string (filters, sort, page) for the tab, so "back to
 * the list" links from a detail page land on the same filtered view instead of a reset list.
 */

export const LIST_RETURN_PATHS = [
  '/incidents',
  '/services',
  '/postmortems',
  '/runbooks',
  '/users',
  '/teams',
  '/policies',
  '/schedules',
] as const;

const STORAGE_PREFIX = 'opsknight:list-return:';
const MAX_QUERY_LENGTH = 2000;
export const LIST_RETURN_CHANGE_EVENT = 'opsknight:list-return-change';

export type ListReturnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): ListReturnStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage can throw when blocked by browser privacy settings.
    return null;
  }
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function isListReturnPath(pathname: string): boolean {
  return (LIST_RETURN_PATHS as readonly string[]).includes(stripTrailingSlash(pathname));
}

function normalizeQuery(search: string): string {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return query.trim();
}

/** Record (or clear, when the list has no query) the list URL the person is looking at. */
export function rememberListUrl(
  pathname: string,
  search: string,
  storage: ListReturnStorage | null = defaultStorage()
): void {
  if (!storage || !isListReturnPath(pathname)) return;
  const key = STORAGE_PREFIX + stripTrailingSlash(pathname);
  const query = normalizeQuery(search);
  try {
    if (query && query.length <= MAX_QUERY_LENGTH) storage.setItem(key, query);
    else storage.removeItem(key);
  } catch {
    return;
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIST_RETURN_CHANGE_EVENT));
}

export function getRememberedListQuery(
  listPath: string,
  storage: ListReturnStorage | null = defaultStorage()
): string | null {
  if (!storage || !isListReturnPath(listPath)) return null;
  try {
    return storage.getItem(STORAGE_PREFIX + stripTrailingSlash(listPath)) || null;
  } catch {
    return null;
  }
}

function splitHref(href: string): { pathname: string; search: string; hash: string } {
  const hashIndex = href.indexOf('#');
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = beforeHash.indexOf('?');
  return {
    pathname: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    search: queryIndex >= 0 ? beforeHash.slice(queryIndex) : '',
    hash,
  };
}

/**
 * The href to use for a link back to a list: a bare list path (`/incidents`) gains the
 * remembered query; anything else (other routes, hrefs that already carry a query) is unchanged.
 */
export function getListReturnHref(
  href: string,
  storage: ListReturnStorage | null = defaultStorage()
): string {
  const { pathname, search, hash } = splitHref(href);
  if (search || !isListReturnPath(pathname)) return href;
  const query = getRememberedListQuery(pathname, storage);
  return query ? `${stripTrailingSlash(pathname)}?${query}${hash}` : href;
}

/**
 * True when a link from `currentPathname` to `href` is "up" navigation to the list that owns the
 * current page (detail or sub-page), i.e. a back link or breadcrumb that should restore filters.
 */
export function isListReturnNavigation(currentPathname: string, href: string): boolean {
  const { pathname, search } = splitHref(href);
  if (search || !isListReturnPath(pathname)) return false;
  const list = stripTrailingSlash(pathname);
  return stripTrailingSlash(currentPathname).startsWith(`${list}/`);
}
