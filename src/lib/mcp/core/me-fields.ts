/**
 * Body fields that take the caller's own id, so "assign it to me" and "keep me posted" are one
 * call instead of whoami first. Resolved only for a direct (generic) call, where the caller is the
 * person acting; a reviewed change keeps exactly the arguments the reviewer saw.
 */
export const MCP_ME_BODY_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['setIncidentWatcher', ['userId']],
  ['assignIncident', ['assigneeId']],
  ['createIncident', ['assigneeId']],
]);

export const MCP_ME_DESCRIPTION = "User id, or 'me'.";

/** The body with 'me' replaced by the caller's id; any other body is returned unchanged. */
export function resolveMeInBody(
  operationId: string,
  body: Record<string, unknown> | undefined,
  actorId: string
): Record<string, unknown> | undefined {
  const fields = MCP_ME_BODY_FIELDS.get(operationId);
  if (!body || !fields) return body;
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      fields.includes(key) && value === 'me' ? actorId : value,
    ])
  );
}
