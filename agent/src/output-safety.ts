/** Shared by the Agent and control plane. This reduces exposure; arbitrary logs are still sensitive. */
export function sanitizeOutputText(value: string, knownSecrets: readonly string[] = []): string {
  let output = value;
  for (const secret of [...knownSecrets].sort((a, b) => b.length - a.length)) {
    if (secret.length) output = output.split(secret).join('[REDACTED]');
  }
  // JSON output (including legacy inspect output) must never retain environment/config payloads.
  try {
    const parsed: unknown = JSON.parse(output);
    const visit = (node: unknown, depth = 0): unknown => {
      if (depth > 32) return '[REDACTED NESTED OUTPUT]';
      if (Array.isArray(node)) return node.map(value => visit(value, depth + 1));
      if (node && typeof node === 'object')
        return Object.fromEntries(
          Object.entries(node).map(([key, field]) => [
            key,
            /(?:password|passwd|secret|token|credential|authorization|api[_-]?key|private[_-]?key)|^(?:env|environment|data|stringData|annotations)$/i.test(
              key
            )
              ? '[REDACTED]'
              : visit(field, depth + 1),
          ])
        );
      return typeof node === 'string' ? sanitizePlainText(node) : node;
    };
    return JSON.stringify(visit(parsed), null, 2);
  } catch {
    /* Plain text uses the bounded credential patterns below. */
  }
  return sanitizePlainText(output);
}

function sanitizePlainText(output: string): string {
  // No nested quantifiers; values are limited by a quote, line or delimiter.
  return (
    output
      .replace(
        /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g,
        '[REDACTED PRIVATE KEY]'
      )
      // Header prefixes and whitespace are disjoint from the final token character class.
      // eslint-disable-next-line security/detect-unsafe-regex
      .replace(/\b(authorization["']?\s*:\s*)(?:bearer\s+|basic\s+)?[^\s,;]+/gi, '$1[REDACTED]')
      .replace(
        /\b([\w.-]*(?:password|passwd|pwd|token|secret|credential|api[_-]?key)[\w.-]*)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
        '$1=[REDACTED]'
      )
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED AWS ACCESS KEY]')
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
  );
}
