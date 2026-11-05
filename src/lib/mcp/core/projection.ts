// Business strings are data, never instructions. Redaction applies recursively,
// including error and resource responses. No bearer values are included in evidence.
import { sanitizeOutputText } from '../../../../agent/src/output-safety';

/**
 * Field names always removed from results (documented in guides/mcp/security-and-data.md). Their
 * value never reaches an agent; projectedOutputSchema derives from the same rule.
 */
export const MCP_REDACTED_FIELDS =
  /(?:secret|password|token|credential|authorization|api.?key|signed.?url|email|phone|payload|rawOutput|stdout|stderr)|^(?:definition|config|inputValues|executionPlan|environment|env)$/i;
/** The same rule under the name the wire-schema projection uses. */
export const MCP_SENSITIVE_KEY = MCP_REDACTED_FIELDS;
/** Values nested deeper than this are replaced, counted from the root of `data`. */
export const MCP_PROJECTION_DEPTH = 24;

/*
 * Characters a person cannot see but a model reads ("ASCII smuggling"): bidi embeddings,
 * overrides, isolates and marks, zero-width characters, word joiners, invisible operators, the
 * BOM, the soft hyphen, combining grapheme joiner, Mongolian vowel separator and free variation
 * selectors, Khmer inherent vowels, Hangul fillers, the deprecated format controls, interlinear
 * annotation marks, shorthand and musical format controls, the rest of the default-ignorable
 * planes, every Unicode tag character, and a zero-width joiner anywhere but
 * between two emoji. A subdivision flag (black flag, tag letters, cancel tag) is the one
 * legitimate use of tag characters and is kept whole. Variation selectors carry hidden bytes as
 * easily ("emoji smuggling": one per byte after a visible character), so only a single selector
 * from the basic block (e.g. the emoji presentation selector) is kept; the supplement block and
 * every selector that follows another selector are removed.
 */
const INVISIBLE =
  // No nested quantifiers, so matching is linear. safe-regex reads the source without the u
  // flag and takes \u{...} code points for quantifiers; each alternative passes it on its own.
  // eslint-disable-next-line security/detect-unsafe-regex
  /(\u{1F3F4}[\u{E0061}-\u{E007A}]{2,7}\u{E007F})|[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff0-\ufffb\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0100}-\u{E0FFF}]|(?<=[\ufe00-\ufe0f\u{E0100}-\u{E01EF}])[\ufe00-\ufe0f]|(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}]\ufe0f?)\u200d|\u200d(?!\p{Extended_Pictographic})|[\u{E0000}-\u{E00FF}]/gu;

export function stripInvisibleText(value: string) {
  return value.replace(INVISIBLE, (_match, flag: string | undefined) => flag ?? '');
}

/**
 * A URL that may carry credential access loses what grants it: userinfo removes the whole URL,
 * a query or fragment (signatures, tokens) is cut so the dashboard or runbook path survives.
 */
function safeUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return '[REDACTED_URL]';
    return url.search || url.hash ? `${url.origin}${url.pathname}?[query removed]` : raw;
  } catch {
    return '[INVALID_URL]';
  }
}

export function projectMcpData(
  value: unknown,
  redacted: string[] = [],
  path = '',
  depth = 0
): unknown {
  if (depth > MCP_PROJECTION_DEPTH) {
    redacted.push(path);
    return '[REDACTED_DEPTH]';
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      projectMcpData(item, redacted, `${path}/${index}`, depth + 1)
    );
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([raw, child]) => {
        // Keys of open maps (labels, custom fields) are business text too, and a hidden
        // character must not carry a sensitive name past the check below.
        const key = stripInvisibleText(raw);
        const field = `${path}/${key}`;
        if (MCP_REDACTED_FIELDS.test(key)) {
          redacted.push(field);
          return [key, '[REDACTED]'];
        }
        if (key !== raw) redacted.push(field);
        return [key, projectMcpData(child, redacted, field, depth + 1)];
      })
    );
  }
  if (typeof value === 'string') {
    // Suppress bearer material and URLs that may convey credential access.
    const safe = sanitizeOutputText(stripInvisibleText(value))
      .replace(/\b(?:Bearer\s+\S+|ok_[A-Za-z0-9_-]{16,})/gi, '[REDACTED]')
      .replace(/https?:\/\/[^\s<>"']+/gi, safeUrl);
    if (safe !== value) redacted.push(path);
    return safe;
  }
  return value;
}

/**
 * The redaction log as evidence: one pattern per field with array indices folded to a star, so a
 * 50-row list reports each redacted column once instead of 50 times. The total stays exact.
 */
export function summarizeRedactions(paths: readonly string[]) {
  return {
    redactedFields: [...new Set(paths.map(path => path.replace(/\/\d+(?=\/|$)/g, '/*')))],
    redactedCount: paths.length,
  };
}

/**
 * Directory and audit reads expose only reviewed fields: every other member of each `data` item
 * is dropped before redaction, so personal data (email, phone, IP address, job details) never
 * reaches an agent even under a name the redaction rule does not know. Keyed by operationId.
 */
export const MCP_FIELD_ALLOWLISTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['listUsers', new Set(['id', 'name', 'role', 'status', 'teams'])],
  ['getUser', new Set(['id', 'name', 'role', 'status', 'teams'])],
  [
    'listAuditLogs',
    new Set([
      'id',
      'action',
      'entityType',
      'entityId',
      'actorId',
      'actorName',
      'details',
      'createdAt',
    ]),
  ],
]);

function pickFields(value: unknown, allowed: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map(item => pickFields(item, allowed));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)));
}

/** Applies an operation's field allowlist to the `data` of a REST envelope; others pass through. */
export function allowMcpFields(operationId: string, envelope: unknown): unknown {
  const allowed = MCP_FIELD_ALLOWLISTS.get(operationId);
  if (!allowed || !envelope || typeof envelope !== 'object' || Array.isArray(envelope))
    return envelope;
  const { data, ...rest } = envelope as { data?: unknown };
  return { ...rest, data: pickFields(data, allowed) };
}
