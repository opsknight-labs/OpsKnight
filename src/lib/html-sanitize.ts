/** HTML escaping and link sanitising for server-rendered markup (Jira, Teams, legacy HTML). */

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Returns an HTML-escaped http(s)/mailto/tel URL, or '#' for anything else. */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    const unescaped = trimmed.replace(/&amp;/g, '&');
    return escapeHtml(unescaped);
  }
  return '#';
}
