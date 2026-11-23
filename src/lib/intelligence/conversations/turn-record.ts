import 'server-only';
import type { SquireEvent, SquireRequest } from '../squire/contract';
import type { SavedActionReference, SavedTurnInput } from './contract';
import { recordExchange } from './store';

/**
 * One streamed Squire turn, collected into what saved history keeps: the answer text, its citations,
 * notices, confirmed-action references and the turn's evidence envelope. Shared by the live chat route and
 * answers that finish in the background, so both save exactly the same record.
 */
export class SquireTurnRecorder {
  answer = '';
  failed = false;
  completed = false;
  private memory?: SavedTurnInput;
  private readonly notices: string[] = [];
  private readonly actions: SavedActionReference[] = [];
  private citations: Extract<SquireEvent, { type: 'citations' }>['items'] = [];

  /** Takes in one event. Returns false for server-only events, which must never reach the browser. */
  observe(event: SquireEvent): boolean {
    if (event.type === 'memory') {
      this.memory = event.turn;
      return false;
    }
    if (event.type === 'delta') this.answer += event.text;
    else if (event.type === 'error') this.failed = true;
    else if (event.type === 'done') this.completed = true;
    else if (event.type === 'notice' && this.notices.length < 4)
      this.notices.push(event.text.slice(0, 1_000));
    else if (event.type === 'citations') this.citations = event.items.slice(0, 8);
    else if (
      event.type === 'proposal' &&
      event.proposal.kind === 'WRITE' &&
      event.proposal.receiptId &&
      this.actions.length < 2
    )
      // Catalog and plan cards have no incident; their outcome lookup stays owner-only (outcomes.ts).
      this.actions.push({
        receiptId: event.proposal.receiptId,
        action: event.proposal.action,
        title: event.proposal.title,
        ...(event.proposal.incidentId ? { incidentId: event.proposal.incidentId } : {}),
      });
    return true;
  }

  /** Nothing worth keeping: no text and no confirmed action. */
  get empty(): boolean {
    return !this.answer.trim() && this.actions.length === 0;
  }

  /**
   * Saves the question and this answer to the person's history and returns the conversation it went to.
   * `incidentId` must already be checked as readable by the person. Throws when storage fails.
   */
  save(input: {
    userId: string;
    request: SquireRequest;
    incidentId?: string;
    completion: 'COMPLETED' | 'INTERRUPTED';
  }): Promise<string> {
    const { request, completion } = input;
    return recordExchange({
      userId: input.userId,
      conversationId: request.conversationId,
      incidentId: input.incidentId,
      question: request.message,
      answer: this.answer.trim() ? this.answer : 'Review the suggested action.',
      dataClass: this.memory?.dataClass,
      turn: {
        ...this.memory,
        // An interrupted answer is kept as the person's record but never replayed to the model.
        ...(completion === 'INTERRUPTED' ? { verified: false } : {}),
        context: input.incidentId
          ? { kind: 'incident', id: input.incidentId }
          : (request.pageContext ?? { kind: 'general', id: 'general' }),
        completion,
        citations: this.citations,
        actions: this.actions,
        notices: [...new Set([...(this.memory?.notices ?? []), ...this.notices])].slice(0, 4),
      },
    });
  }
}
