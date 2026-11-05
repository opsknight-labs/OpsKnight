import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  createRequestStateCodec,
  inputRequired,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { mcpRequestStateKey } from '../auth/config';
import { MCP_PROTOCOL_REVISION } from './revision';

/**
 * URL-mode elicitation for a self-approving administrator: the client opens OpsKnight's own
 * review page, where the person approves or rejects as they would from the shared link. It is
 * never form mode: a form answer can come from the host or the agent, so it could not stand for
 * an independent decision. The reply is ignored; the retry re-reads the approval status.
 */

/** Signed into requestState; readable by the client, so it holds ids and a link, never secrets. */
export type ReviewState = { kind: 'operation' | 'runbook'; id: string; reviewUrl: string };

/** The approval commit window: a pending review stays resumable at most this long. */
const REVIEW_STATE_TTL_SECONDS = 1800;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only a 2026-07-28 request whose own envelope declares URL elicitation. */
export function supportsUrlElicitation(ctx: ServerContext | undefined) {
  const envelope = new Map(Object.entries(ctx?.mcpReq.envelope ?? {}));
  if (envelope.get(PROTOCOL_VERSION_META_KEY) !== MCP_PROTOCOL_REVISION) return false;
  const capabilities = envelope.get(CLIENT_CAPABILITIES_META_KEY);
  const elicitation = isObject(capabilities) ? capabilities.elicitation : undefined;
  return isObject(elicitation) && isObject(elicitation.url);
}

/**
 * The requestState codec for one session's principal: state minted for one grant, actor or method
 * is refused for any other (-32602), as is tampered or expired state. Without a key nothing is
 * minted and every echoed state is refused.
 */
export function reviewStateCodec(grantId: string, actorId: string) {
  const key = mcpRequestStateKey();
  const codec = key
    ? createRequestStateCodec<ReviewState>({
        key,
        ttlSeconds: REVIEW_STATE_TTL_SECONDS,
        bind: ctx => `${ctx.mcpReq.method}\0${grantId}\0${actorId}`,
      })
    : null;
  return {
    enabled: codec !== null,
    verify: async (state: string, ctx: ServerContext) => {
      if (!codec) throw new Error('unavailable');
      const payload = await codec.verify(state, ctx);
      if (
        !isObject(payload) ||
        (payload.kind !== 'operation' && payload.kind !== 'runbook') ||
        typeof payload.id !== 'string' ||
        typeof payload.reviewUrl !== 'string'
      )
        throw new Error('malformed');
      return payload;
    },
    async elicitReview(state: ReviewState, ctx: ServerContext): Promise<InputRequiredResult> {
      if (!codec) throw new Error('unavailable');
      return inputRequired({
        inputRequests: {
          review: inputRequired.elicitUrl({
            url: state.reviewUrl,
            message: 'Review and approve this change in OpsKnight',
          }),
        },
        requestState: await codec.mint(state, ctx),
      });
    },
  };
}
