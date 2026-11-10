/**
 * `?squire=open&q=<question>`: a link that opens the assistant with a question in the composer.
 *
 * The question is only placed in the composer; the person sends it. A link must never be able to start
 * a turn (and spend AI budget) on someone's behalf just by being opened.
 */
export const SQUIRE_PARAM = 'squire';
export const SQUIRE_QUESTION_PARAM = 'q';
const MAX_QUESTION = 2000;

export interface SquireDeepLink {
  question?: string;
}

/** The deep link in a query string, or null when the page was not opened with one. */
export function readSquireDeepLink(search: string | null | undefined): SquireDeepLink | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  if (params.get(SQUIRE_PARAM) !== 'open') return null;
  const question = params.get(SQUIRE_QUESTION_PARAM)?.trim().slice(0, MAX_QUESTION);
  return question ? { question } : {};
}

/** The same URL without the deep-link parameters, so a reload or a copied link does not reopen the panel. */
export function withoutSquireDeepLink(url: string): string {
  const parsed = new URL(url, 'http://local');
  parsed.searchParams.delete(SQUIRE_PARAM);
  parsed.searchParams.delete(SQUIRE_QUESTION_PARAM);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** A link that opens the assistant on `path` with `question` ready to send. */
export function squireDeepLink(path: string, question?: string): string {
  const parsed = new URL(path, 'http://local');
  parsed.searchParams.set(SQUIRE_PARAM, 'open');
  const trimmed = question?.trim().slice(0, MAX_QUESTION);
  if (trimmed) parsed.searchParams.set(SQUIRE_QUESTION_PARAM, trimmed);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
