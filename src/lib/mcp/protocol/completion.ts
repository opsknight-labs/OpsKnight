import { MCP_OPERATION_MAP } from '../catalog';
import { callMcpOperation, type ExecutionContext } from '../core/execution';

export const MAX_COMPLETIONS = 10;

/** Domain list operations whose authorized first page backs completion for that resource kind. */
export const COMPLETION_SOURCES = {
  incidents: 'listIncidents',
  services: 'listServices',
  schedules: 'listSchedules',
  runbooks: 'listRunbooks',
  reports: 'listSavedReports',
  postmortems: 'listPostmortems',
  'escalation-policies': 'listEscalationPolicies',
} as const;
export type CompletionSource = keyof typeof COMPLETION_SOURCES;

/** Whether the list operation takes a free-text `search` filter in its canonical query. */
function acceptsSearch(operationId: string) {
  const query = MCP_OPERATION_MAP.get(operationId)?.inputSchema.properties.query as
    { properties?: Record<string, unknown> } | undefined;
  return Boolean(query?.properties && Object.hasOwn(query.properties, 'search'));
}

const ID_PREFIX = /^[A-Za-z0-9_-]*$/;

/**
 * Suggests IDs the principal can already list: an id starting with the typed value, or a row
 * whose name or title contains it (case-insensitive). Where the list takes `search`, the typed
 * text is passed to it so matches beyond the first page are found; otherwise one bounded,
 * permission-filtered page is matched. Only IDs are returned. Any failure (no authority, budget,
 * disabled) yields no suggestions rather than an error, so completion never becomes an
 * existence oracle.
 */
export async function completeAuthorizedIds(
  context: ExecutionContext,
  source: CompletionSource,
  value: string
): Promise<string[]> {
  // Printable text only, bounded; control characters never reach a query.
  if (value.length > 128 || !/^[\x20-\x7E]*$/.test(value)) return [];
  // eslint-disable-next-line security/detect-object-injection -- source is a closed CompletionSource union
  const operationId = COMPLETION_SOURCES[source];
  const needle = value.trim().toLowerCase();
  const matches = (row: unknown): row is { id: string } => {
    if (!row || typeof row !== 'object') return false;
    const { id, name, title } = row as { id?: unknown; name?: unknown; title?: unknown };
    if (typeof id !== 'string') return false;
    if (ID_PREFIX.test(value) && id.startsWith(value)) return true;
    return (
      needle.length > 0 &&
      [name, title].some(text => typeof text === 'string' && text.toLowerCase().includes(needle))
    );
  };
  const page = async (search?: string) => {
    const result = await callMcpOperation(context, operationId, {
      query: { limit: 25, ...(search ? { search } : {}) },
    });
    const envelope = result.data as { data?: unknown };
    return (Array.isArray(envelope?.data) ? envelope.data : []).filter(matches).map(row => row.id);
  };
  try {
    const found = needle && acceptsSearch(operationId) ? await page(value.trim()) : [];
    // A typed id prefix rarely matches a text search; fall back to the first page.
    const ids = found.length ? found : await page();
    return [...new Set(ids)].slice(0, MAX_COMPLETIONS);
  } catch {
    return [];
  }
}
