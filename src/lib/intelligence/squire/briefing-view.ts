import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getAiSettings } from '../ai/settings';
import { getProactiveNotesForActor } from '../memory/proactive-view';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { readIncidentForActor, type ReadableIncident } from './deterministic';

/** How many rows of each kind the pinned briefing carries; the same cut the chat briefing uses. */
export const PINNED_BRIEFING_ROWS = 3;

/**
 * The incident briefing the assistant panel pins above the conversation. It is the visible half of the
 * briefing a chat turn is given (`brief` in `chat.ts`): the top similar incidents, likely changes and
 * runbooks, each with the finding id its row in the insights inspector is anchored by.
 */
export interface PinnedBriefing {
  incidentId: string;
  similar: Array<{
    findingId: string;
    incidentId: string;
    title: string;
    status: string;
    matchPercent: number;
  }>;
  changes: Array<{
    findingId: string;
    changeId: string;
    summary: string;
    kind: string;
    leadMinutes: number;
  }>;
  runbooks: Array<{
    findingId: string;
    runbookId: string;
    name: string;
    succeeded: number;
    eligible: number;
  }>;
  /** The incident's one AI summary (the proactive briefing's), shared with the insights inspector. */
  summary?: { headline: string; currentState: string } | null;
}

const short = (text: string, max = 160) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * The pinned briefing for one incident as the actor may see it, or null when there is nothing to pin.
 *
 * Null covers every reason to stay silent, without telling them apart: the assistant is off, the actor
 * is not an active app user with the suggestions capability, the incident is not readable, the
 * service's intelligence mode shows no suggestions (OFF and SHADOW), or there are no findings. Scoping,
 * the mode check and the row bounds are the view functions' own; each read fails soft.
 */
export async function getPinnedBriefingForActor(
  actor: AuthorizationActor,
  incidentId: string,
  client: typeof prisma = prisma,
  /** The incident the caller already read through `actor`'s visibility (skips the re-read). */
  readable?: ReadableIncident
): Promise<PinnedBriefing | null> {
  if (
    actor.apiKey ||
    actor.status !== 'ACTIVE' ||
    !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)
  )
    return null;
  const [settings, incident] = await Promise.all([
    getAiSettings(client).catch(() => null),
    readable?.id === incidentId
      ? readable
      : readIncidentForActor(actor, incidentId, client).catch(() => null),
  ]);
  if (!settings?.squireEnabled || !incident) return null;

  const [similar, response, proactive] = await Promise.all([
    getSimilarIncidentsForActor(incident.id, actor, client).catch(() => null),
    getResponseIntelligenceForActor(incident.id, actor, client).catch(() => null),
    // Already scoped: its AI text is shown only to a viewer who may read every input it was written from.
    getProactiveNotesForActor(incident.id, actor, { incident, kinds: ['BRIEFING'] }).catch(
      () => null
    ),
  ]);
  const ai = proactive?.briefing?.ai;
  const briefing: PinnedBriefing = {
    incidentId: incident.id,
    similar: (similar ?? []).slice(0, PINNED_BRIEFING_ROWS).map(row => ({
      findingId: row.findingId,
      incidentId: row.incidentId,
      title: short(row.title),
      status: row.status,
      matchPercent: row.matchPercent,
    })),
    changes: (response?.changes ?? []).slice(0, PINNED_BRIEFING_ROWS).map(row => ({
      findingId: row.findingId,
      changeId: row.changeId,
      summary: short(row.summary),
      kind: row.kind,
      leadMinutes: row.leadMinutes,
    })),
    runbooks: (response?.runbooks ?? []).slice(0, PINNED_BRIEFING_ROWS).map(row => ({
      findingId: row.findingId,
      runbookId: row.runbookId,
      name: short(row.name),
      succeeded: row.succeeded,
      eligible: row.eligible,
    })),
    summary: ai
      ? { headline: short(ai.headline, 200), currentState: short(ai.currentState, 600) }
      : null,
  };
  return briefing.summary ||
    briefing.similar.length + briefing.changes.length + briefing.runbooks.length > 0
    ? briefing
    : null;
}
