import type { ListResourcesResult } from '@modelcontextprotocol/server';
import { callMcpOperation, type ExecutionContext } from '../core/execution';
import { COMPLETION_SOURCES, type CompletionSource } from './completion';

/**
 * Rows per resource template on resources/list. The SDK 2.4.0 list callback receives no cursor,
 * so each domain contributes one bounded page and the result is not paged.
 */
export const RESOURCE_LIST_LIMIT = 20;

/** resources/list runs one list operation per resource template; the route charges for each. */
export const RESOURCE_LIST_COST = 6;

/** Narrowing per domain; the others keep their list's default order (most recent first). */
const LIST_QUERIES: Partial<Record<CompletionSource, Record<string, string>>> = {
  incidents: { status: 'ACTIVE' },
};

const RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Stored text on one line: a link or resource name is not a place for business text to add lines. */
export function oneLineLabel(text: string) {
  return text.replace(/[\p{Cc}\s]+/gu, ' ').slice(0, 80);
}

/**
 * The resources of one template the principal can browse, read through the domain's list
 * operation so scopes, disabled capabilities, row authorization and projection all apply. Any
 * failure (no authority, budget, disabled) lists nothing for that domain instead of failing the
 * whole resources/list.
 */
export async function listAuthorizedResources(
  context: ExecutionContext,
  source: CompletionSource
): Promise<ListResourcesResult> {
  try {
    // eslint-disable-next-line security/detect-object-injection -- source is a closed CompletionSource union
    const operationId = COMPLETION_SOURCES[source];
    const result = await callMcpOperation(context, operationId, {
      // eslint-disable-next-line security/detect-object-injection -- source is a closed CompletionSource union
      query: { limit: RESOURCE_LIST_LIMIT, ...LIST_QUERIES[source] },
    });
    const rows = (result.data as { data?: unknown } | undefined)?.data;
    return {
      resources: (Array.isArray(rows) ? rows : []).slice(0, RESOURCE_LIST_LIMIT).flatMap(row => {
        const { id, title, name } = (row ?? {}) as {
          id?: unknown;
          title?: unknown;
          name?: unknown;
        };
        if (typeof id !== 'string' || !RESOURCE_ID.test(id)) return [];
        const label = typeof title === 'string' ? title : typeof name === 'string' ? name : id;
        return [
          {
            uri: `opsknight://${source}/${id}`,
            name: oneLineLabel(label).trim() || id,
            mimeType: 'application/json',
          },
        ];
      }),
    };
  } catch {
    return { resources: [] };
  }
}
