import { MCP_SEARCH_KEYWORDS } from './search-keywords';

// Words assistants add to natural queries ("list all the services", "who is on call") that
// say nothing about which operation is wanted. "me" and "my" are not filler: they point to whoami.
const FILLER = new Set([
  'a',
  'about',
  'all',
  'an',
  'and',
  'any',
  'are',
  'by',
  'check',
  'for',
  'from',
  'i',
  'in',
  'is',
  'of',
  'show',
  'the',
  'there',
  'to',
  'what',
  'which',
  'who',
  'with',
]);

type Searchable = {
  operationId: string;
  tool?: string | null;
  domain: string;
  summary?: string | null;
  risk?: string;
  status?: string;
};

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** One form for singular and plural: "policies" and "policy", "incidents" and "incident". */
function stem(word: string) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ss|us|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us)$/.test(word)) return word.slice(0, -1);
  return word;
}

const stems = (values: readonly string[]) => new Set(values.map(stem));

// Reads first, then the statuses an assistant can use with the least ceremony.
const STATUS_RANK = new Map([
  ['CURATED', 0],
  ['DISCOVERABLE', 1],
  ['SENSITIVE_READ', 2],
  ['APPROVAL_REQUIRED', 3],
]);
const isRead = (operation: Searchable) =>
  operation.risk === undefined || operation.risk === 'R0' || operation.status === 'SENSITIVE_READ';

/**
 * Natural-language operation search. Each query word is matched as a whole word, singular or
 * plural, against the operation id, tool and domain words and its search keywords (2 points), or
 * else its contract summary (1 point); "open" therefore never matches "reopen". A query naming an
 * operation or tool exactly gets 3 more. Every operation with a positive score is returned, best
 * first, then reads before changes, then by status, then shorter ids; a query of only filler
 * words matches everything, in catalog order.
 */
export function searchCapabilities<T extends Searchable>(operations: readonly T[], query: string) {
  const terms = [...new Set(words(query))].filter(term => !FILLER.has(term));
  if (!terms.length) return [...operations];
  const phrase = terms.join(' ');
  const scored = operations.map((operation, index) => {
    const idWords = words(operation.operationId);
    const name = stems([
      // The id as written too, so "listteams" or "getincident" still finds it.
      operation.operationId.toLowerCase(),
      ...idWords,
      ...(operation.tool ?? '').split('_'),
      ...operation.domain.toLowerCase().split('-'),
      ...(MCP_SEARCH_KEYWORDS.get(operation.operationId) ?? []).flatMap(words),
    ]);
    const summary = stems(words(operation.summary ?? ''));
    let score = terms.reduce((total, term) => {
      const form = stem(term);
      return total + (name.has(form) ? 2 : summary.has(form) ? 1 : 0);
    }, 0);
    const exact =
      phrase === idWords.join(' ') ||
      phrase === operation.operationId.toLowerCase() ||
      terms.join('_') === operation.tool;
    if (score > 0 && exact) score += 3;
    return { operation, score, index, length: idWords.length };
  });
  return scored
    .filter(entry => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(isRead(b.operation)) - Number(isRead(a.operation)) ||
        (STATUS_RANK.get(a.operation.status ?? '') ?? 0) -
          (STATUS_RANK.get(b.operation.status ?? '') ?? 0) ||
        a.length - b.length ||
        a.index - b.index
    )
    .map(entry => entry.operation);
}
