import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../ai/redact';
import { streamSquire } from './chat';
import {
  SQUIRE_LIMITS,
  squireRequestSchema,
  type SquireCitation,
  type SquireEvent,
  type SquireRequest,
} from './contract';

/**
 * One Squire turn collected into a single answer, for surfaces that cannot stream: Slack and Microsoft
 * Teams replies, and the MCP `ask_squire` tool. It runs exactly the turn the web assistant runs
 * (`streamSquire`: basic or AI, the person's own permissions, the same tools, citations and proposals) and
 * adds nothing that writes. Proposals come back sealed and unexecuted; the caller decides whether to offer
 * them as buttons (chat) or only describe them (MCP).
 */

type ProposalEvent = Extract<SquireEvent, { type: 'proposal' }>['proposal'];

export interface SquireSurfaceAnswer {
  name: string;
  mode: 'ai' | 'basic';
  text: string;
  notices: string[];
  citations: SquireCitation[];
  proposals: ProposalEvent[];
  /** The deterministic intent of a basic answer, when there was one. */
  intent?: string;
  /** Set when there is no answer: the assistant is off, the person has no access, or the turn failed. */
  error?: string;
}

export interface SquireSurfaceInput {
  message: string;
  incidentId?: string;
  pageContext?: SquireRequest['pageContext'];
}

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TEXT = 12_000;
const MAX_NOTICES = 4;
const MAX_PROPOSALS = 2;

export async function collectSquireTurn(
  actor: AuthorizationActor,
  input: SquireSurfaceInput,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<SquireSurfaceAnswer> {
  const answer: SquireSurfaceAnswer = {
    name: 'Squire',
    mode: 'basic',
    text: '',
    notices: [],
    citations: [],
    proposals: [],
  };
  const parsed = squireRequestSchema.safeParse({
    message: input.message.slice(0, SQUIRE_LIMITS.messageMax),
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    ...(input.pageContext ? { pageContext: input.pageContext } : {}),
  });
  if (!parsed.success) return { ...answer, error: 'Ask a question of up to 2,000 characters.' };

  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const events = streamSquire(actor, parsed.data, controller.signal);
  try {
    for await (const event of events) {
      if (controller.signal.aborted) break;
      switch (event.type) {
        case 'meta':
          answer.name = event.name;
          answer.mode = event.mode;
          if (event.intent) answer.intent = event.intent;
          break;
        case 'delta':
          if (answer.text.length < MAX_TEXT) answer.text += event.text;
          break;
        case 'notice':
          if (answer.notices.length < MAX_NOTICES) answer.notices.push(event.text.slice(0, 500));
          break;
        case 'citations':
          answer.citations = event.items;
          break;
        case 'proposal':
          if (answer.proposals.length < MAX_PROPOSALS) answer.proposals.push(event.proposal);
          break;
        case 'error':
          answer.error = event.message;
          break;
        default:
          // tool progress, suggestions, memory and context proofs are browser-only concerns.
          break;
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (controller.signal.aborted) await events.return(undefined).catch(() => undefined);
  }
  answer.text = redactSecrets(answer.text.slice(0, MAX_TEXT));
  if (controller.signal.aborted && !answer.error) {
    if (answer.text.trim()) answer.notices.push('This answer was cut short.');
    else answer.error = 'The assistant took too long to answer. Try again, or ask in OpsKnight.';
  }
  if (answer.error) answer.text = '';
  return answer;
}
