/**
 * Values passed to dangerouslySetInnerHTML must not be able to terminate their
 * containing HTML element. Status-page branding is administrator controlled,
 * but the resulting page is public and must remain safe for its visitors.
 */
export function toSafeStyleTagContent(value: unknown): string {
  if (typeof value !== 'string') return '';

  // A literal `<` can begin `</style>` and turn CSS into executable HTML.
  // A CSS escape keeps the content valid CSS while preventing HTML parsing.
  return value.replaceAll('<', '\\3C ');
}

/**
 * Custom CSS for the admin preview's shadow root.
 *
 * Templates set tokens on `:root`, which is the document on the live page but does not apply
 * inside the preview shadow tree. Mapping `:root` to `:host` keeps the same file working on both
 * surfaces until the template pack is rewritten against `.status-page-surface`.
 */
export function toPreviewCustomCss(value: unknown): string {
  return toSafeStyleTagContent(value).replace(/(^|[^:]):root\b/g, '$1:host');
}

export function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return character;
    }
  });
}
