type Severity = 'critical' | 'error' | 'warning' | 'info';
type EventAction = 'trigger' | 'resolve' | 'acknowledge';

const CRITICAL_KEYS = ['critical', 'crit', 'p1', 'sev0', 'sev1', 'high', 'fatal', 'down', 'page'];
const ERROR_KEYS = ['error', 'err', 'p2', 'sev2'];
const WARNING_KEYS = ['warning', 'warn', 'p3', 'sev3', 'degraded', 'medium'];
const INFO_KEYS = ['info', 'informational', 'p4', 'p5', 'low', 'ok', 'normal'];

const RESOLVE_KEYS = ['resolve', 'resolved', 'close', 'closed', 'recover', 'recovered', 'ok', 'up'];
const ACK_KEYS = ['ack', 'acked', 'acknowledge', 'acknowledged'];

const NEGATIONS = ['not', 'no', 'non', 'never'];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .trim()
    .split(/[\s_\-.:,;/|]+/);
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase().trim();
  const tokens = tokenize(text);
  return keywords.some(key => {
    // For short tokens (<= 3 chars like 'up', 'ok', 'ack', 'err'), require exact token match
    if (key.length <= 3) {
      return tokens.includes(key) || normalized === key;
    }
    return normalized.includes(key) || tokens.includes(key);
  });
}

/**
 * Lifecycle-word match: short values need an exact token, longer ones may sit
 * inside a token ('recovery', 'auto_resolved') unless negated, so 'broken'
 * never matches 'ok' and 'unresolved'/'unacknowledged' never match at all.
 */
export function matchesActionValue(text: string, values: string[]): boolean {
  const normalized = text.toLowerCase().trim();
  const tokens = tokenize(text);
  // A preceding negation ('Not Recovered', 'no ack') cancels the match.
  const negated = (i: number) => i > 0 && NEGATIONS.includes(tokens[i - 1]);
  return values.some(raw => {
    const value = raw.toLowerCase();
    if (normalized === value) return true;
    return tokens.some(
      (token, i) =>
        !negated(i) &&
        (token === value ||
          (value.length > 3 && token.includes(value) && !/^(un|non|not)/.test(token)))
    );
  });
}

export function normalizeSeverity(value?: string, fallback: Severity = 'warning'): Severity {
  if (!value) return fallback;
  if (matchesKeyword(value, CRITICAL_KEYS)) return 'critical';
  if (matchesKeyword(value, ERROR_KEYS)) return 'error';
  if (matchesKeyword(value, WARNING_KEYS)) return 'warning';
  if (matchesKeyword(value, INFO_KEYS)) return 'info';
  return fallback;
}

export function normalizeEventAction(
  value?: string,
  fallback: EventAction = 'trigger'
): EventAction {
  if (!value) return fallback;
  if (matchesActionValue(value, ACK_KEYS)) return 'acknowledge';
  if (matchesActionValue(value, RESOLVE_KEYS)) return 'resolve';
  return fallback;
}

export function firstString(
  ...values: Array<string | number | null | undefined>
): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}
