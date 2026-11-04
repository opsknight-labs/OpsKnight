import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { mintContextProof, authorizationContextHash } from '../squire/context-proof';
import { readSourceStates, sourceKey, type SourceIdentity } from '../squire/evidence-access';
import {
  getConversation,
  getHistoryStatus,
  listConversations,
  type ConversationDetail,
  type ConversationSummary,
} from './store';

const mayRead = (actor: AuthorizationActor) =>
  actor.status === 'ACTIVE' &&
  !actor.apiKey &&
  hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ);

/** Ownership alone never makes an incident conversation readable after incident access is revoked. */
export async function listConversationsForActor(
  actor: AuthorizationActor
): Promise<ConversationSummary[]> {
  if (!mayRead(actor) || !(await getHistoryStatus()).enabled) return [];
  const conversations = await listConversations(actor.id);
  const sources = conversations.flatMap(row =>
    row.incidentId ? [{ kind: 'incident' as const, id: row.incidentId }] : []
  );
  const states = await readSourceStates(actor, sources);
  return conversations.filter(
    row => !row.incidentId || states.has(sourceKey({ kind: 'incident', id: row.incidentId }))
  );
}

/**
 * Re-checks every known source before historical answers may be replayed. Revoked/deleted sources hide
 * the derived answer; changed sources retain a dated record but cannot be replayed as current context.
 * Legacy text remains the owner's private record, clearly unverified and excluded from AI replay.
 */
export async function getConversationForActor(
  actor: AuthorizationActor,
  id: string
): Promise<ConversationDetail | null> {
  if (!mayRead(actor) || !(await getHistoryStatus()).enabled) return null;
  const saved = await getConversation(actor.id, id);
  if (!saved) return null;
  const sources: SourceIdentity[] = saved.messages.flatMap(message => [
    ...(message.envelope?.sources ?? []),
    ...(message.envelope?.citations ?? []),
    ...(message.envelope?.actions ?? []).map(action => ({
      kind: 'incident' as const,
      id: action.incidentId,
    })),
  ]);
  // Put the primary scope first so a full source-check budget never hides the context itself.
  if (saved.incidentId) sources.unshift({ kind: 'incident', id: saved.incidentId });
  const states = await readSourceStates(actor, sources);
  if (saved.incidentId && !states.has(sourceKey({ kind: 'incident', id: saved.incidentId })))
    return null;
  const messages = await Promise.all(
    saved.messages.map(async message => {
      const envelope = message.envelope;
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
      const replayable =
        message.role === 'user' ||
        Boolean(
          envelope?.verified &&
          envelope.authorizationHash === authorizationContextHash(actor) &&
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
                ? 'Sources for this older answer are unverified. It will not be used as context for a new AI answer.'
                : undefined;
      const filtered = envelope
        ? {
            ...envelope,
            citations: envelope.verified
              ? envelope.citations.filter(source => states.has(sourceKey(source)))
              : [],
            actions: envelope.actions.filter(action =>
              states.has(sourceKey({ kind: 'incident', id: action.incidentId }))
            ),
            notices: [...new Set([...envelope.notices, ...(notice ? [notice] : [])])].slice(0, 4),
          }
        : undefined;
      const contextProof = replayable
        ? await mintContextProof({
            actor,
            incidentId: saved.incidentId,
            role: message.role,
            text: message.content,
            dataClass: message.dataClass,
            sources: message.role === 'assistant' ? filtered?.sources : [],
            observedAt: message.createdAt,
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
