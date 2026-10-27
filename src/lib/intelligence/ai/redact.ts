const PLACEHOLDER = '[redacted]';

// Each pattern is anchored on a distinctive prefix or delimiter and uses bounded quantifiers, so none can
// backtrack catastrophically on adversarial input.
const PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]{3,40}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z ]{3,40}PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,512}/g,
  /\bsk-[A-Za-z0-9_-]{16,200}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,200}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\b/g,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"',;]{6,200}/gi,
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
