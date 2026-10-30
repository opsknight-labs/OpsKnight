/**
 * URL state for the MCP settings page. Every section and list filter lives in the query string, so
 * views are linkable and the server only loads what the selected section shows. Anything invalid
 * falls back to a safe default instead of failing the page.
 */

export const MCP_PAGE_SIZE = 20;

export const MCP_SECTIONS = [
  'overview',
  'connect',
  'connections',
  'assistants',
  'approvals',
  'policy',
  'capabilities',
] as const;
export type McpSection = (typeof MCP_SECTIONS)[number];

/** Sections that only administrators can open. */
export const MCP_ADMIN_SECTIONS: ReadonlySet<McpSection> = new Set([
  'assistants',
  'approvals',
  'policy',
  'capabilities',
]);

export const GRANT_STATUSES = ['active', 'expired', 'revoked', 'all'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const CLIENT_STATUSES = ['active', 'revoked', 'all'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_TYPES = ['all', 'automatic', 'metadata', 'manual'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const APPROVAL_KINDS = ['operations', 'runbooks'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATES = ['pending', 'decided'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export type McpListParams = {
  section: McpSection;
  page: number;
  q: string;
  grantStatus: GrantStatus;
  clientStatus: ClientStatus;
  clientType: ClientType;
  /** Narrows connections to one registered assistant. */
  clientId: string | null;
  approvalKind: ApprovalKind;
  approvalState: ApprovalState;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(choices: readonly T[], value: string | undefined, fallback: T): T {
  return value !== undefined && (choices as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const MAX_PAGE = 10_000;

export function parseMcpListParams(raw: RawParams, isAdmin: boolean): McpListParams {
  const requested = oneOf(MCP_SECTIONS, first(raw.tab), 'overview');
  const section = !isAdmin && MCP_ADMIN_SECTIONS.has(requested) ? 'overview' : requested;
  const pageNumber = Number.parseInt(first(raw.page) ?? '', 10);
  const clientId = first(raw.client) ?? '';
  return {
    section,
    page: Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.min(pageNumber, MAX_PAGE) : 1,
    q: (first(raw.q) ?? '').trim().slice(0, 100),
    grantStatus: oneOf(GRANT_STATUSES, first(raw.status), 'active'),
    clientStatus: oneOf(CLIENT_STATUSES, first(raw.status), 'all'),
    clientType: oneOf(CLIENT_TYPES, first(raw.type), 'all'),
    // Client ids are cuids or HTTPS metadata URLs; anything else cannot match and is ignored.
    clientId:
      isAdmin && clientId.length > 0 && clientId.length <= 256 && !/\s/.test(clientId)
        ? clientId
        : null,
    approvalKind: oneOf(APPROVAL_KINDS, first(raw.kind), 'operations'),
    approvalState: oneOf(APPROVAL_STATES, first(raw.state), 'pending'),
  };
}

export const MCP_SETTINGS_PATH = '/settings/integrations/mcp';

/**
 * Builds a link within the page. Values equal to their default are dropped so URLs stay short;
 * pass `null` to remove a parameter.
 */
export function mcpHref(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (key === 'tab' && value === 'overview') continue;
    if (key === 'page' && Number(value) === 1) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${MCP_SETTINGS_PATH}?${query}` : MCP_SETTINGS_PATH;
}

export function totalPages(total: number, pageSize = MCP_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize));
}
