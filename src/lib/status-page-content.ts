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
