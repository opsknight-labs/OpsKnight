const PLACEHOLDER = '[redacted]';

// Each pattern is anchored on a distinctive prefix or delimiter and uses bounded quantifiers, so none can
// backtrack catastrophically on adversarial input.
const PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]{3,40}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z ]{3,40}PRIVATE KEY-----/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,512}/g,
  /\bsk-[A-Za-z0-9_-]{16,200}\b/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,200}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,100}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,200}\b/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,200}/g,
  /\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\b/g,
  // key=value and "key": "value" forms, including prefixed names such as DB_PASSWORD, client_secret and
  // access_token. Each prefix segment must end in a delimiter, so matching stays linear.
  // eslint-disable-next-line security/detect-unsafe-regex -- every repeated segment must end in a delimiter, so matching is linear; covered by the adversarial-input test
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9]{1,40}[_.-]){0,4}(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|credentials?)["']?\s{0,8}[:=]\s{0,8}["']?[^\s"',;}]{6,200}/gi,
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/:@]{1,100}:[^\s/@]{1,100}@/gi,
];

/**
 * Removes credential-shaped substrings before text is sent to a model. This is a safety net, not a
 * guarantee: the primary control is that only deliberately selected, minimal context is ever sent.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, PLACEHOLDER);
  return out;
}
