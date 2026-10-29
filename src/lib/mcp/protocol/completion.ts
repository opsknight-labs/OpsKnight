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

/**
 * Suggests IDs the principal can already list. One bounded, permission-filtered page per call;
 * any failure (no authority, budget, disabled) yields no suggestions rather than an error, so
 * completion never becomes an existence oracle.
 */
export async function completeAuthorizedIds(
  context: ExecutionContext,
  source: CompletionSource,
  prefix: string
): Promise<string[]> {
  if (prefix.length > 128 || !/^[A-Za-z0-9_-]*$/.test(prefix)) return [];
  try {
    // eslint-disable-next-line security/detect-object-injection -- source is a closed CompletionSource union
    const result = await callMcpOperation(context, COMPLETION_SOURCES[source], {
      query: { limit: 25 },
    });
    const envelope = result.data as { data?: unknown };
    const rows = Array.isArray(envelope?.data) ? envelope.data : [];
    return rows
      .map(row => (row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.startsWith(prefix))
      .slice(0, MAX_COMPLETIONS);
  } catch {
    return [];
  }
}
