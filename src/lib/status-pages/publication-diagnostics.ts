/** API-safe publication diagnostics. Detailed transport/storage errors remain in privileged
 * control-plane diagnostics and logs, never in ordinary REST responses or replayed job DTOs.
 */
export function safePublicationDiagnostic<T extends { lastError?: string | null }>(state: T): T {
  return state.lastError ? { ...state, lastError: 'PUBLICATION_RECONCILIATION_FAILED' } : state;
}
export function safePublicationResult<T extends { publication: { lastError?: string | null } }>(
  result: T
): T {
  return { ...result, publication: safePublicationDiagnostic(result.publication) };
}
