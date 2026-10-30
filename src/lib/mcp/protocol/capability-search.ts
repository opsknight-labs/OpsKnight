// Words assistants add to natural queries ("list all the services", "who is on call") that
// say nothing about which operation is wanted.
const FILLER = new Set([
  'a',
  'all',
  'an',
  'and',
  'any',
  'by',
  'for',
  'from',
  'i',
  'in',
  'is',
  'me',
  'my',
  'of',
  'the',
  'to',
  'what',
  'which',
  'who',
  'with',
]);

type Searchable = { operationId: string; tool?: string | null; domain: string };

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Natural-language operation search. Each query word matches the operation id (as words and as
 * written), tool and domain, tolerating plurals. Operations matching the most words are returned,
 * in catalog order; a query of only filler words matches everything.
 */
export function searchCapabilities<T extends Searchable>(operations: readonly T[], query: string) {
  const terms = [...new Set(words(query))].filter(term => !FILLER.has(term));
  if (!terms.length) return [...operations];
  const scored = operations.map(operation => {
    const text = [
      operation.operationId.toLowerCase(),
      ...words(operation.operationId),
      operation.tool ?? '',
      operation.domain.toLowerCase(),
    ].join(' ');
    const score = terms.filter(
      term =>
        text.includes(term) ||
        (term.length > 3 && term.endsWith('s') && text.includes(term.slice(0, -1)))
    ).length;
    return { operation, score };
  });
  const best = Math.max(0, ...scored.map(entry => entry.score));
  return best === 0
    ? []
    : scored.filter(entry => entry.score === best).map(entry => entry.operation);
}
