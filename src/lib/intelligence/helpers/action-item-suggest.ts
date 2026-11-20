import { trigramSimilarity } from '../similarity/scoring';

/**
 * Helpers for an action item being written: open look-alikes and a likely owner. Pure and client-safe; the
 * loader reads the rows under the reader's scope.
 */

/** Stricter than pg_trgm's 0.3 default: action-item titles are short and share a lot of filler words. */
export const ACTION_ITEM_DUPLICATE_MIN = 0.5;
export const ACTION_ITEM_DUPLICATE_LIMIT = 3;
const MIN_TITLE_CHARS = 8;

export interface DuplicateActionItem {
  id: string;
  title: string;
  incidentId: string;
  similarity: number;
}

const normalize = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function findDuplicateActionItems(
  title: string,
  open: ReadonlyArray<{ id: string; title: string; incidentId: string }>
): DuplicateActionItem[] {
  const draft = normalize(title);
  if (draft.length < MIN_TITLE_CHARS) return [];
  return open
    .map(item => ({
      ...item,
      similarity: Math.round(trigramSimilarity(draft, normalize(item.title)) * 100) / 100,
    }))
    .filter(item => item.similarity >= ACTION_ITEM_DUPLICATE_MIN)
    .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
    .slice(0, ACTION_ITEM_DUPLICATE_LIMIT);
}

export interface SuggestedOwner {
  userId: string;
  name: string;
  reason: string;
}

/** The lead of the team owning the incident's service, else the postmortem's author. */
export function suggestActionItemOwner(input: {
  teamLead: { id: string; name: string } | null;
  teamName: string | null;
  author: { id: string; name: string } | null;
}): SuggestedOwner | null {
  if (input.teamLead) {
    return {
      userId: input.teamLead.id,
      name: input.teamLead.name,
      reason: `Leads ${input.teamName ?? 'the team'}, which owns the service`,
    };
  }
  if (input.author) {
    return { userId: input.author.id, name: input.author.name, reason: 'Wrote this postmortem' };
  }
  return null;
}
