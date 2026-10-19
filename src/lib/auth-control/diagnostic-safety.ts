/** Provider error strings are untrusted; expose only a bounded, redacted explanation. */
export function redactDiagnosticText(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /(["']?(?:client_secret|id_token|access_token|refresh_token|secret|password|token|authorization|code)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;]+)/gi,
      '$1[redacted]'
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token redacted]')
    .replace(/https?:\/\/\S+/gi, '[URL redacted]')
    .slice(0, 500);
}
