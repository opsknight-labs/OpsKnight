import { mcpOrigin } from '../auth/config';

/** OpsKnight web pages for the resource kinds that have a detail page, by resource kind. */
export const MCP_WEB_PAGES = new Map<string, string>([
  ['incidents', '/incidents'],
  ['services', '/services'],
  ['schedules', '/schedules'],
  ['runbooks', '/runbooks'],
]);

/** List reads whose rows link to a detail page: the row's `id` fills the page template. */
export const MCP_LIST_WEB_SOURCES = new Map<string, string>([
  ['listIncidents', 'incidents'],
  ['listServices', 'services'],
  ['listSchedules', 'schedules'],
  ['listRunbooks', 'runbooks'],
]);

/** The public origin, or undefined when it is not configured; a link is optional, never fatal. */
export function mcpWebOrigin(): string | undefined {
  try {
    return mcpOrigin();
  } catch {
    return undefined;
  }
}

/** `https://host/incidents/{id}` for a list read with a detail page, once per result. */
export function mcpListWebUrlTemplate(operationId: string): string | undefined {
  const source = MCP_LIST_WEB_SOURCES.get(operationId);
  const page = source ? MCP_WEB_PAGES.get(source) : undefined;
  const origin = page ? mcpWebOrigin() : undefined;
  return page && origin ? `${origin}${page}/{id}` : undefined;
}
