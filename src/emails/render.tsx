import type { ReactElement } from 'react';
import { render, toPlainText } from '@react-email/render';

const RAW_TAG = 'opsknight-raw';

/**
 * Emits an HTML fragment verbatim. React cannot render HTML comments, and Outlook's
 * conditional comments (`<!--[if mso]>`) and VML must reach the client byte-exact.
 * The wrapper element is stripped by {@link renderEmail}.
 */
export function RawHtml({ html }: { html: string }) {
  return <opsknight-raw dangerouslySetInnerHTML={{ __html: html }} />;
}

declare module 'react' {
  // Email clients (Outlook/Word) need the legacy attribute; React passes it through.
  interface TdHTMLAttributes<T> extends HTMLAttributes<T> {
    bgcolor?: string | undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'opsknight-raw': { dangerouslySetInnerHTML: { __html: string } };
    }
  }
}

const RAW_OPEN = new RegExp(`<${RAW_TAG}>`, 'g');
const RAW_CLOSE = new RegExp(`</${RAW_TAG}>`, 'g');

export type RenderedEmail = { html: string; text: string };

/**
 * Renders an email element to HTML plus a plain-text alternative.
 * Pass `text` to keep a hand-written plain-text body (security and auth emails
 * have reviewed wording); otherwise it is derived from the HTML.
 */
export async function renderEmail(
  element: ReactElement,
  options: { text?: string } = {}
): Promise<RenderedEmail> {
  const markup = await render(element);
  const html = markup.replace(RAW_OPEN, '').replace(RAW_CLOSE, '');
  return { html, text: options.text ?? emailHtmlToText(html) };
}

/** Plain-text conversion for any email HTML (also used at send time for fan-out templates). */
export function emailHtmlToText(html: string): string {
  if (!html) return '';
  return toPlainText(html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: '[data-skip-in-text=true]', format: 'skip' },
      { selector: 'h1', options: { uppercase: false, leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'h2', options: { uppercase: false, leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'table.text-data-table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, linkBrackets: false } },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
