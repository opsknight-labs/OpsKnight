import { PREPAGING_LIMITS, type Matcher, type PrePagingInput } from './contract';

/** A matcher with its regular expression compiled once, at snapshot load, never on the hot path. */
export interface CompiledMatcher {
  field: Matcher['field'];
  key?: string;
  op: Matcher['op'];
  value: string;
  regex: RegExp | null;
}

export function compileMatcher(matcher: Matcher): CompiledMatcher {
  return {
    field: matcher.field,
    key: matcher.key?.toLowerCase(),
    op: matcher.op,
    value: (matcher.value ?? '').toLowerCase(),
    // Patterns pass assertSafeRegex when saved; compilation happens once per snapshot, not per event.
    // eslint-disable-next-line security/detect-non-literal-regexp
    regex: matcher.op === 'regex' && matcher.value ? new RegExp(matcher.value, 'i') : null,
  };
}

function labelOf(labels: Readonly<Record<string, string>>, key: string): string | null {
  if (!Object.hasOwn(labels, key)) return null;
  const value: unknown = Reflect.get(labels, key);
  return typeof value === 'string' ? value : null;
}

function fieldValue(matcher: CompiledMatcher, input: PrePagingInput): string | null {
  switch (matcher.field) {
    case 'source':
      return input.source;
    case 'summary':
      return input.summary;
    case 'severity':
      return input.severity;
    case 'resourceKey':
      return input.resourceKey;
    case 'fingerprintHash':
      return input.fingerprintHash;
    case 'dedupKey':
      return input.dedupKey;
    case 'label':
      return matcher.key ? labelOf(input.labels, matcher.key) : null;
    default:
      return null;
  }
}

export function matches(matcher: CompiledMatcher, input: PrePagingInput): boolean {
  const raw = fieldValue(matcher, input);
  if (matcher.op === 'exists') return raw !== null && raw.length > 0;
  if (raw === null) return false;
  const value = raw.slice(0, PREPAGING_LIMITS.textLength).toLowerCase();
  switch (matcher.op) {
    case 'equals':
      return value === matcher.value;
    case 'contains':
      return value.includes(matcher.value);
    case 'prefix':
      return value.startsWith(matcher.value);
    case 'regex':
      return matcher.regex !== null && matcher.regex.test(value);
    default:
      return false;
  }
}

export function matchesAll(matchers: readonly CompiledMatcher[], input: PrePagingInput): boolean {
  return matchers.length > 0 && matchers.every(matcher => matches(matcher, input));
}

/** `candidate` holds every label of `required` with the same value. Empty `required` is a subset of anything. */
export function isLabelSubset(
  required: Readonly<Record<string, string>>,
  candidate: Readonly<Record<string, string>> | null | undefined
): boolean {
  if (!candidate) return Object.keys(required).length === 0;
  for (const [key, value] of Object.entries(required))
    if (labelOf(candidate, key) !== value) return false;
  return true;
}
