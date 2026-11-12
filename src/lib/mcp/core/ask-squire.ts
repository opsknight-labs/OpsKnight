import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { checkRateLimit } from '@/lib/rate-limit';
import { collectSquireTurn } from '@/lib/intelligence/squire/surfaces';
import { askSquireAllowedTools, askSquireInputSchema, canAskSquire } from './ask-squire-contract';
import { isAskSquireEnabled } from './ask-squire-settings';
import { McpBoundaryError, requireMcp } from './errors';
import { projectMcpData } from './projection';
import { mcpWebOrigin } from './web-links';

/**
 * `ask_squire`: one read-only Squire turn for the connection's user (contract and scope gate in
 * ask-squire-contract.ts). Nothing is executed: a suggested action is returned as a description with
 * a link, never with its sealed proposal token, so only the person can confirm it, in OpsKnight.
 */

/** Questions per person per minute over MCP. Each can be an AI call. */
export const ASK_SQUIRE_PER_MINUTE = 10;

const web = (href: string | undefined) => {
  const origin = mcpWebOrigin();
  return origin && href?.startsWith('/') ? `${origin}${href}` : undefined;
};

export async function askSquireForMcp(
  actor: AuthorizationActor,
  args: unknown,
  /** The MCP policy's sensitive-read switch, as the server was created with. Off unless passed. */
  options: { sensitiveReads?: boolean } = {}
) {
  const parsed = askSquireInputSchema.safeParse(args);
  requireMcp(parsed.success, 'MCP_INVALID_ARGUMENTS', 400);
  requireMcp(canAskSquire(actor), 'MCP_OPERATION_FORBIDDEN', 403);
  if (!(await isAskSquireEnabled({ fresh: true })))
    throw new McpBoundaryError('MCP_CAPABILITY_DISABLED', 403);
  const rate = await checkRateLimit(`squire:mcp:${actor.id}`, ASK_SQUIRE_PER_MINUTE, 60_000);
  if (!rate.allowed)
    throw new McpBoundaryError('MCP_RATE_LIMITED', 429, true, undefined, {
      retryAfterSeconds: Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000)),
    });
  // Squire refuses API-key principals (it is a browser surface); the scope gate above stands in for
  // the connection's consent, and every read below still runs under the person's own role and teams.
  // Tools for areas the connection was not granted are left out of the turn, so the answer never
  // carries more than the connection could read itself.
  const readTools = askSquireAllowedTools(actor.apiKey?.scopes ?? [], {
    sensitiveReads: options.sensitiveReads === true,
  });
  const person: AuthorizationActor = {
    id: actor.id,
    role: actor.role,
    status: actor.status,
    teamIds: actor.teamIds,
  };
  const { question, incidentId } = parsed.data;
  const answer = await collectSquireTurn(
    person,
    { message: question, ...(incidentId ? { incidentId } : {}) },
    { timeoutMs: 30_000, scope: { readTools } }
  );
  if (answer.error) throw new McpBoundaryError('MCP_UNAVAILABLE', 503, true, answer.error);
  return {
    mode: answer.mode,
    // Answer text can quote alerts and notes: projected like any other business text.
    answer: projectMcpData(answer.text),
    notices: answer.notices.map(notice => projectMcpData(notice)),
    citations: answer.citations.map(citation => {
      const url = web(citation.href);
      return {
        kind: citation.kind,
        label: projectMcpData(citation.label),
        ...(url ? { url } : {}),
      };
    }),
    suggestedActions: answer.proposals.map(proposal => {
      const url = web(proposal.href ?? `/incidents/${encodeURIComponent(proposal.incidentId)}`);
      return {
        title: projectMcpData(proposal.title),
        detail: projectMcpData(proposal.detail),
        incidentId: proposal.incidentId,
        ...(url ? { url } : {}),
        executed: false,
        ...(proposal.untrustedContext ? { basedOnUntrustedContent: true } : {}),
      };
    }),
    note: 'Read-only. Suggested actions are not executed; the person confirms them in OpsKnight.',
  };
}
