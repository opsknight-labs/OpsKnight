/**
 * Deterministic text normalization. Volatile values (ids, addresses, timestamps, counters, generated
 * pod suffixes) are replaced by stable placeholders so recurring problems yield the same template.
 *
 * Safety properties (all covered by tests):
 *  - pure and total: never throws, whatever the input
 *  - input is truncated BEFORE any pattern runs, bounding worst-case work
 *  - idempotent: mask(mask(x)) === mask(x)
 *  - bounded output length
 */

export const MAX_RAW_TEXT_LENGTH = 2048;
export const MAX_TEMPLATE_LENGTH = 512;

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/g;
// Deliberately loose (anything user@host-shaped) and free of nested quantifiers so it stays linear.
const EMAIL_PATTERN = /[^\s@<>]{1,64}@[^\s@<>]{1,128}/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}/g;
// Trailing parts of a timestamp are consumed in small steps right after the <ts> placeholder.
const TIMESTAMP_SECONDS_PATTERN = /(?<=<ts>):\d{2}/g;
const TIMESTAMP_FRACTION_PATTERN = /(?<=<ts>)\.\d{1,9}/g;
const TIMESTAMP_ZONE_PATTERN = /(?<=<ts>)(?:z|[+-]\d{2}:?\d{2})/g;
const IPV4_PATTERN = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const IP_PORT_PATTERN = /(?<=<ip>):\d{1,5}\b/g;
const IP_PREFIX_PATTERN = /(?<=<ip>)\/\d{1,2}\b/g;
const HEX_PATTERN = /\b(?:0x)?[0-9a-f]{8,64}\b/g;
// Candidate dash-separated identifiers; segments are inspected in code so no pattern nests quantifiers.
const DASHED_IDENTIFIER_PATTERN = /\b[a-z0-9][a-z0-9-]{12,118}[a-z0-9]\b/g;
const POD_HASH_PATTERN = /^[a-z0-9]{8,10}$/;
const POD_SUFFIX_PATTERN = /^[a-z0-9]{5}$/;
const WORKLOAD_SEGMENT_PATTERN = /^[a-z][a-z0-9]{0,30}$/;
const DIGIT_RUN_PATTERN = /\d[\d.,]*/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Kubernetes-style generated names (<workload>-<replicaset hash>-<pod suffix>) collapse to the
 * workload so every replica of a deployment yields the same template.
 */
function collapseGeneratedName(identifier: string): string {
  const segments = identifier.split('-');
  if (segments.length < 3 || segments.length > 8) return identifier;
  const suffix = segments[segments.length - 1];
  const hash = segments[segments.length - 2];
  const workload = segments.slice(0, -2);
  if (
    !POD_SUFFIX_PATTERN.test(suffix) ||
    !POD_HASH_PATTERN.test(hash) ||
    !/\d/.test(hash + suffix) ||
    !workload.every(segment => WORKLOAD_SEGMENT_PATTERN.test(segment))
  ) {
    return identifier;
  }
  return `${workload.join('-')}-<pod>`;
}

function maskDigitRun(run: string): string {
  const trailing = run.match(/[.,]+$/)?.[0] ?? '';
  return `<num>${trailing}`;
}

/**
 * The narrower mask used for label values: only identifiers that differ between replicas of the same thing
 * (generated pod names, IP addresses, UUIDs, long hex ids, timestamps). Short numbers and readable names stay,
 * because in a label they usually carry meaning (`eu-west-1`, a status code, a version).
 */
export function maskVolatileIdentifiers(input: string): string {
  let text = input.slice(0, MAX_RAW_TEXT_LENGTH).toLowerCase();
  text = text.replace(UUID_PATTERN, '<uuid>');
  text = text.replace(TIMESTAMP_PATTERN, '<ts>');
  text = text
    .replace(TIMESTAMP_SECONDS_PATTERN, '')
    .replace(TIMESTAMP_FRACTION_PATTERN, '')
    .replace(TIMESTAMP_ZONE_PATTERN, '');
  text = text
    .replace(IPV4_PATTERN, '<ip>')
    .replace(IP_PORT_PATTERN, '')
    .replace(IP_PREFIX_PATTERN, '');
  text = text.replace(DASHED_IDENTIFIER_PATTERN, collapseGeneratedName);
  text = text.replace(HEX_PATTERN, match => (/\d/.test(match) ? '<hex>' : match));
  return text.replace(WHITESPACE_PATTERN, ' ').trim();
}

export function maskVolatileText(input: unknown): string {
  if (typeof input !== 'string') return '';
  let text = input.slice(0, MAX_RAW_TEXT_LENGTH).toLowerCase();

  text = text.replace(URL_PATTERN, '<url>');
  if (text.includes('@')) text = text.replace(EMAIL_PATTERN, '<email>');
  text = text.replace(UUID_PATTERN, '<uuid>');
  text = text.replace(TIMESTAMP_PATTERN, '<ts>');
  text = text
    .replace(TIMESTAMP_SECONDS_PATTERN, '')
    .replace(TIMESTAMP_FRACTION_PATTERN, '')
    .replace(TIMESTAMP_ZONE_PATTERN, '');
  text = text
    .replace(IPV4_PATTERN, '<ip>')
    .replace(IP_PORT_PATTERN, '')
    .replace(IP_PREFIX_PATTERN, '');
  // Generated names run before the generic hex rule, which would otherwise consume the replica hash.
  text = text.replace(DASHED_IDENTIFIER_PATTERN, collapseGeneratedName);
  // Only strings that contain a digit are identifiers; plain words made of a-f stay readable.
  text = text.replace(HEX_PATTERN, match => (/\d/.test(match) ? '<hex>' : match));
  text = text.replace(DIGIT_RUN_PATTERN, maskDigitRun);

  // Trim again after truncating so a cut landing on whitespace cannot break idempotence.
  return text.replace(WHITESPACE_PATTERN, ' ').trim().slice(0, MAX_TEMPLATE_LENGTH).trimEnd();
}

const PLACEHOLDER_PATTERN = /<[a-z]+>/g;
const WORD_PATTERN = /[a-z]{2,32}/g;
export const MAX_TOKENS = 64;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'with',
  'from',
  'that',
  'this',
  'not',
  'but',
  'its',
  'can',
  'will',
  'all',
  'out',
  'any',
  'too',
  'than',
  'then',
  'into',
  'over',
  'on',
  'in',
  'at',
  'to',
  'of',
  'is',
  'it',
  'or',
  'by',
  'an',
  'as',
  'be',
  'no',
  'if',
]);

/** Sorted, unique, bounded word tokens from an already-masked template (placeholders excluded). */
export function extractTokens(maskedText: string): string[] {
  const words = maskedText.replace(PLACEHOLDER_PATTERN, ' ').match(WORD_PATTERN) ?? [];
  const unique = new Set<string>();
  for (const word of words) if (!STOP_WORDS.has(word)) unique.add(word);
  return [...unique].sort().slice(0, MAX_TOKENS);
}
