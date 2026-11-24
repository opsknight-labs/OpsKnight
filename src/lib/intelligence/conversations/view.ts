import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { mintContextProof, authorizationContextHash } from '../squire/context-proof';
import { readSourceStates, sourceKey, type SourceIdentity } from '../squire/evidence-access';
import {
  getConversation,
  getHistoryStatus,
  listConversationPage,
  type ConversationPage,
  type ConversationDetail,
  type ConversationSummary,
} from './store';
import type { ConversationCursor } from './contract';
import type { AiSettingsView } from '../ai/settings';

/** Turn contexts whose readability can be re-checked; the others hold no derived data of their own. */
const RECHECKED_CONTEXTS: ReadonlySet<string> = new Set([
  'incident',
  'service',
  'runbook',
  'schedule',
  'alert',
  'change',
  'status_page',
]);

const mayRead = (actor: AuthorizationActor) =>
  actor.status === 'ACTIVE' &&
  !actor.apiKey &&
  hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ);

/** Ownership alone never makes an incident conversation readable after incident access is revoked. */
export async function listConversationsForActor(
  actor: AuthorizationActor
): Promise<ConversationSummary[]> {
  return (await listConversationPageForActor(actor)).conversations;
}

export async function listConversationPageForActor(
  actor: AuthorizationActor,
  cursor?: ConversationCursor
): Promise<ConversationPage> {
  if (!mayRead(actor) || !(await getHistoryStatus()).enabled)
    return { conversations: [], nextCursor: null };
  const page = await listConversationPage(actor.id, cursor);
  const sources = page.conversations.flatMap(row =>
    row.incidentId ? [{ kind: 'incident' as const, id: row.incidentId }] : []
  );
  const states = await readSourceStates(actor, sources);
  return {
    ...page,
    conversations: page.conversations.filter(
      row => !row.incidentId || states.has(sourceKey({ kind: 'incident', id: row.incidentId }))
    ),
  };
}

/**
 * Re-checks every known source before historical answers may be replayed. Revoked/deleted sources hide
 * the derived answer; changed sources retain a dated record but cannot be replayed as current context.
 * Legacy text remains the owner's private record, clearly unverified and excluded from AI replay.
 */
export async function getConversationForActor(
  actor: AuthorizationActor,
  id: string,
  /** Settings the caller already read this request, saving two round trips. */
  loaded?: Pick<AiSettingsView, 'squireHistoryEnabled' | 'squireHistoryRetentionDays'>
): Promise<ConversationDetail | null> {
  if (!mayRead(actor) || !(await getHistoryStatus(loaded)).enabled) return null;
  const saved = await getConversation(actor.id, id, loaded);
  if (!saved) return null;
  // Older turns carry no page of their own: they were asked in the conversation's incident.
  const contextOf = (message: (typeof saved.messages)[number]): SourceIdentity | null => {
    const context = message.envelope?.context;
    if (!context) return saved.incidentId ? { kind: 'incident', id: saved.incidentId } : null;
    // A general question (asked with no page) is about no record: nothing to re-check, no incident fallback.
    if (context.kind === 'general') return null;
    return RECHECKED_CONTEXTS.has(context.kind)
      ? { kind: context.kind as SourceIdentity['kind'], id: context.id }
      : null;
  };
  const sources: SourceIdentity[] = saved.messages.flatMap(message => [
    ...(contextOf(message) ? [contextOf(message)!] : []),
    ...(message.envelope?.sources ?? []),
    ...(message.envelope?.citations ?? []),
    // Catalog and plan receipts carry no incident: they are the owner's own and need no re-check.
    ...(message.envelope?.actions ?? []).flatMap(action =>
      action.incidentId ? [{ kind: 'incident' as const, id: action.incidentId }] : []
    ),
  ]);
  // Put the primary scope first so a full source-check budget never hides the context itself.
  if (saved.incidentId) sources.unshift({ kind: 'incident', id: saved.incidentId });
  const states = await readSourceStates(actor, sources);
  if (saved.incidentId && !states.has(sourceKey({ kind: 'incident', id: saved.incidentId })))
    return null;
  const messages = await Promise.all(
    saved.messages.map(async message => {
      const envelope = message.envelope;
      const context = contextOf(message);
      // A turn asked on a page the person can no longer open is withheld, question and answer alike.
      if (context && !states.has(sourceKey(context)))
        return {
          ...message,
          content:
            message.role === 'user'
              ? 'A question asked on a page you can no longer open.'
              : 'This earlier answer is unavailable because you can no longer open the page it was about.',
          envelope: undefined,
          replayable: false,
        };
      const unavailable = envelope?.sources.some(source => !states.has(sourceKey(source))) ?? false;
      if (message.role === 'assistant' && unavailable)
        return {
          ...message,
          content:
            'This earlier answer is unavailable because one or more sources could not be verified.',
          envelope: undefined,
          replayable: false,
          notice: 'Open the original source or ask for a fresh answer.',
        };
      const accessChanged = Boolean(
        envelope?.authorizationHash &&
        envelope.authorizationHash !== authorizationContextHash(actor)
      );
      const stale =
        envelope?.sources.some(
          source =>
            source.sourceUpdatedAt &&
            states.get(sourceKey(source))?.updatedAt !== source.sourceUpdatedAt
        ) ?? false;
      // A completed answer is replayed even when it read nothing or its sources were unverified (labelled so,
      // see earlierAnswerLabel), so a follow-up such as "yes, do it" keeps its context. Interrupted answers,
      // answers recorded under different access and answers whose sources have since changed are not.
      const replayable =
        message.role === 'user' ||
        Boolean(
          envelope?.authorizationHash === authorizationContextHash(actor) &&
          envelope.completion === 'COMPLETED' &&
          !stale
        );
      const notice =
        message.role !== 'assistant'
          ? undefined
          : accessChanged
            ? 'Your access changed after this answer was recorded. Ask for a fresh answer before continuing.'
            : stale
              ? 'Sources changed after this answer was recorded. It is kept as history and will not be used for a new AI answer.'
              : !envelope?.verified
                ? 'Sources for this older answer are unverified. A new AI answer treats it as unverified history.'
                : undefined;
      const filtered = envelope
        ? {
            ...envelope,
            citations: envelope.verified
              ? envelope.citations.filter(source => states.has(sourceKey(source)))
              : [],
            actions: envelope.actions.filter(
              action =>
                !action.incidentId ||
                states.has(sourceKey({ kind: 'incident', id: action.incidentId }))
            ),
            notices: [...new Set([...envelope.notices, ...(notice ? [notice] : [])])].slice(0, 4),
          }
        : undefined;
      const contextProof = replayable
        ? await mintContextProof({
            actor,
            incidentId: context?.kind === 'incident' ? context.id : null,
            role: message.role,
            text: message.content,
            dataClass: message.dataClass,
            sources: message.role === 'assistant' ? filtered?.sources : [],
            observedAt: message.createdAt,
            verified: message.role === 'user' || Boolean(envelope?.verified),
          }).catch(() => undefined)
        : undefined;
      return {
        ...message,
        ...(filtered ? { envelope: filtered } : {}),
        replayable,
        ...(notice ? { notice } : {}),
        ...(contextProof ? { contextProof } : {}),
      };
    })
  );
  return { ...saved, messages };
}
