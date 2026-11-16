/**
 * Suggestions for the manual incident form, derived from past incidents that read like the draft. Pure:
 * the loader supplies candidates the reader may see, already scored for content similarity (0..1).
 */
export interface DraftCandidate {
  incidentId: string;
  title: string;
  status: string;
  urgency: string;
  serviceId: string;
  serviceName: string;
  similarity: number;
  createdAt: Date;
}

export interface DraftSuggestions {
  service: { id: string; name: string; matches: number } | null;
  urgency: { value: string; matches: number } | null;
  duplicate: {
    incidentId: string;
    title: string;
    status: string;
    serviceName: string;
    similarity: number;
  } | null;
}

/** Below this a past incident does not read like the draft and gets no vote. */
export const SUGGEST_MIN_SIMILARITY = 0.3;
/** An unresolved incident at or above this is shown as a probable duplicate. */
export const DUPLICATE_MIN_SIMILARITY = 0.6;
/** One look-alike is an anecdote; a suggestion needs at least this many agreeing incidents... */
export const SUGGEST_MIN_MATCHES = 2;
/** ...holding at least this share of the similarity-weighted vote. */
export const SUGGEST_MIN_SHARE = 0.6;

function vote<T extends string>(
  rows: readonly DraftCandidate[],
  pick: (row: DraftCandidate) => T
): { value: T; matches: number } | null {
  const tally = new Map<T, { weight: number; matches: number }>();
  let total = 0;
  for (const row of rows) {
    const entry = tally.get(pick(row)) ?? { weight: 0, matches: 0 };
    entry.weight += row.similarity;
    entry.matches += 1;
    tally.set(pick(row), entry);
    total += row.similarity;
  }
  const [winner] = [...tally.entries()].sort(
    (a, b) => b[1].weight - a[1].weight || (a[0] < b[0] ? -1 : 1)
  );
  if (!winner || winner[1].matches < SUGGEST_MIN_MATCHES) return null;
  if (winner[1].weight / total < SUGGEST_MIN_SHARE) return null;
  return { value: winner[0], matches: winner[1].matches };
}

export function suggestForDraft(
  candidates: readonly DraftCandidate[],
  current: { serviceId?: string | null; urgency?: string | null } = {}
): DraftSuggestions {
  const alike = candidates.filter(row => row.similarity >= SUGGEST_MIN_SIMILARITY);

  // A chosen service is never second-guessed; urgency then follows that service's own history.
  const serviceVote = current.serviceId ? null : vote(alike, row => row.serviceId);
  const serviceId = current.serviceId ?? serviceVote?.value ?? null;
  const urgencyVote = vote(
    serviceId ? alike.filter(row => row.serviceId === serviceId) : alike,
    row => row.urgency
  );

  const [duplicate] = alike
    .filter(row => row.status !== 'RESOLVED' && row.similarity >= DUPLICATE_MIN_SIMILARITY)
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.incidentId < b.incidentId ? -1 : 1)
    );

  return {
    service: serviceVote
      ? {
          id: serviceVote.value,
          name: alike.find(row => row.serviceId === serviceVote.value)!.serviceName,
          matches: serviceVote.matches,
        }
      : null,
    urgency: urgencyVote && urgencyVote.value !== current.urgency ? urgencyVote : null,
    duplicate: duplicate
      ? {
          incidentId: duplicate.incidentId,
          title: duplicate.title,
          status: duplicate.status,
          serviceName: duplicate.serviceName,
          similarity: Math.round(duplicate.similarity * 100) / 100,
        }
      : null,
  };
}
